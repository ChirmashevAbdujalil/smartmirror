"""Fotorealistik virtual kiyib ko'rish (generativ AI).

Ko'zgu xaridorning toza kamera suratini va tanlangan kiyimlarni yuboradi. Bu yerda surat tanlangan
xizmatga beriladi: FASHN AI, Replicate (masalan, IDM-VTON) yoki do'konning o'z GPU serveri (HTTP).
Bir nechta kiyim bo'lsa, ular ketma-ket kiydiriladi: oldingi natija keyingi qadamning "odam surati" bo'ladi.

Ish fon oqimida bajariladi (bitta ko'zgu / kichik do'kon uchun yetarli). Katta yuklamada Celery/RQ
kabi navbatga o'tkazish oson: faqat `start_job` ni almashtirish kifoya.

Eslatma: tashqi xizmatlarning API formati vaqt o'tishi bilan o'zgarishi mumkin — model nomi admin
panelda sozlanadi. Ochiq kodli VTON modellarining ko'pi faqat notijorat litsenziyada.
"""
import base64
import io
import json
import logging
import threading
import time
import urllib.error
import urllib.request

from django.conf import settings
from django.core.files.base import ContentFile
from django.db import close_old_connections
from django.utils import timezone

from .models import SLOTS, AIProvider, AISettings, JobStatus, PhotorealJob, Product

log = logging.getLogger(__name__)

# Kiyimni kiydirish tartibi: avval ko'ylak/ichki kiyim, so'ng ustki, oxirida past.
CHAIN_ORDER = ["toliq", "ichki", "ustki", "past"]
FASHN_CATEGORY = {"toliq": "one-pieces", "ichki": "tops", "ustki": "tops", "past": "bottoms"}
IDM_CATEGORY = {"toliq": "dresses", "ichki": "upper_body", "ustki": "upper_body", "past": "lower_body"}
POLL_SECONDS = 2


class VtonError(Exception):
    """Xaridorga ko'rsatish mumkin bo'lgan xato."""


# ---------------- HTTP yordamchilari ----------------

def _http(method, url, headers=None, body=None, timeout=60):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Content-Type": "application/json", "Accept": "application/json", **(headers or {}),
    })
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode(errors="replace")
        log.warning("VTON HTTP %s %s: %s", e.code, url, detail)
        if e.code in (401, 403):
            raise VtonError("AI xizmati kalitni qabul qilmadi (admin: AI sozlamalari)")
        if e.code == 402:
            raise VtonError("AI xizmati hisobida mablag' tugagan")
        if e.code == 429:
            raise VtonError("AI xizmati band, birozdan keyin urinib ko'ring")
        raise VtonError(f"AI xizmati xatosi ({e.code})")
    except (urllib.error.URLError, TimeoutError) as e:
        log.warning("VTON tarmoq xatosi %s: %s", url, e)
        raise VtonError("AI xizmatiga ulanib bo'lmadi (internet?)")


def _json(method, url, headers=None, body=None, timeout=60):
    raw = _http(method, url, headers, body, timeout)
    try:
        return json.loads(raw or b"{}")
    except ValueError:
        raise VtonError("AI xizmati noto'g'ri javob qaytardi")


def data_uri(raw: bytes) -> str:
    mime = "image/png" if raw[:8] == b"\x89PNG\r\n\x1a\n" else "image/jpeg"
    return f"data:{mime};base64,{base64.b64encode(raw).decode()}"


def fetch_image(ref: str) -> bytes:
    if ref.startswith("data:"):
        try:
            return base64.b64decode(ref.split(",", 1)[1])
        except (IndexError, ValueError):
            raise VtonError("AI natijasi o'qilmadi")
    if ref.startswith("https://") or ref.startswith("http://"):
        return _http("GET", ref, headers={"Accept": "image/*"}, timeout=60)
    raise VtonError("AI natijasi o'qilmadi")


def _first_output(output):
    if isinstance(output, list):
        output = output[0] if output else None
    if isinstance(output, dict):
        output = output.get("image") or output.get("url")
    if not isinstance(output, str):
        raise VtonError("AI natija qaytarmadi")
    return output


# ---------------- Xizmatlar ----------------

class Provider:
    def __init__(self, cfg: AISettings):
        self.cfg = cfg
        self.deadline = time.monotonic() + cfg.timeout

    def _wait(self):
        if time.monotonic() > self.deadline:
            raise VtonError("AI juda uzoq ishladi, qaytadan urinib ko'ring")
        time.sleep(POLL_SECONDS)

    def run(self, person: bytes, garment: bytes, product: Product) -> bytes:
        raise NotImplementedError


class FashnProvider(Provider):
    base = "https://api.fashn.ai/v1"

    def run(self, person, garment, product):
        headers = {"Authorization": f"Bearer {self.cfg.api_key}"}
        started = _json("POST", f"{self.base}/run", headers, {
            "model_name": self.cfg.model or "tryon-v1.6",
            "inputs": {
                "model_image": data_uri(person),
                "garment_image": data_uri(garment),
                "category": FASHN_CATEGORY[SLOTS[product.kind]],
            },
        })
        if started.get("error") or not started.get("id"):
            raise VtonError("AI so'rovni qabul qilmadi")
        while True:
            st = _json("GET", f"{self.base}/status/{started['id']}", headers)
            if st.get("status") == "completed":
                return fetch_image(_first_output(st.get("output")))
            if st.get("status") in ("failed", "canceled"):
                err = st.get("error") or {}
                log.warning("FASHN xato: %s", err)
                raise VtonError("AI suratni yarata olmadi (odam to'liq ko'rinishi kerak)")
            self._wait()


class ReplicateProvider(Provider):
    base = "https://api.replicate.com/v1"

    def _version(self, headers):
        model = self.cfg.model or "cuuupid/idm-vton"
        if ":" in model:
            return model.split(":", 1)[1]
        info = _json("GET", f"{self.base}/models/{model}", headers)
        version = (info.get("latest_version") or {}).get("id")
        if not version:
            raise VtonError("Replicate modeli topilmadi")
        return version

    def run(self, person, garment, product):
        headers = {"Authorization": f"Bearer {self.cfg.api_key}"}
        pred = _json("POST", f"{self.base}/predictions", {**headers, "Prefer": "wait=30"}, {
            "version": self._version(headers),
            "input": {
                "human_img": data_uri(person),
                "garm_img": data_uri(garment),
                "garment_des": product.name,
                "category": IDM_CATEGORY[SLOTS[product.kind]],
            },
        }, timeout=90)
        while True:
            status = pred.get("status")
            if status == "succeeded":
                return fetch_image(_first_output(pred.get("output")))
            if status in ("failed", "canceled"):
                log.warning("Replicate xato: %s", pred.get("error"))
                raise VtonError("AI suratni yarata olmadi")
            self._wait()
            url = (pred.get("urls") or {}).get("get")
            if not url:
                raise VtonError("AI xizmati noto'g'ri javob qaytardi")
            pred = _json("GET", url, headers)


class HttpProvider(Provider):
    """O'z serverimiz. Kontrakt:
    POST {endpoint}  {"person": dataURI, "garment": dataURI, "category": "ichki|ustki|past|toliq", "description": "..."}
    javob: {"image": dataURI yoki URL}
    """

    def run(self, person, garment, product):
        headers = {"Authorization": f"Bearer {self.cfg.api_key}"} if self.cfg.api_key else {}
        res = _json("POST", self.cfg.endpoint, headers, {
            "person": data_uri(person),
            "garment": data_uri(garment),
            "category": SLOTS[product.kind],
            "description": product.name,
        }, timeout=self.cfg.timeout)
        if res.get("error"):
            raise VtonError(str(res["error"])[:200])
        return fetch_image(_first_output(res.get("image")))


PROVIDERS = {AIProvider.FASHN: FashnProvider, AIProvider.REPLICATE: ReplicateProvider, AIProvider.HTTP: HttpProvider}


# ---------------- Ishni bajarish ----------------

def _read(field):
    field.open("rb")
    try:
        return field.read()
    finally:
        field.close()


def _garment_bytes(job, product):
    stored = job.garment_files.get(str(product.pk))
    if stored:
        from django.core.files.storage import default_storage
        with default_storage.open(stored, "rb") as f:
            return f.read()
    if product.photo:
        return _read(product.photo)
    if product.tryon_image:
        return _read(product.tryon_image)
    raise VtonError(f"\"{product.name}\" uchun rasm yuklanmagan")


def _to_jpeg(raw: bytes) -> bytes:
    from PIL import Image
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception:
        raise VtonError("AI natijasi o'qilmadi")
    buf = io.BytesIO()
    im.convert("RGB").save(buf, "JPEG", quality=90)
    return buf.getvalue()


def run_job(job_id):
    close_old_connections()
    try:
        job = PhotorealJob.objects.get(pk=job_id)
        job.status = JobStatus.RUNNING
        job.save(update_fields=["status"])
        try:
            cfg = AISettings.load()
            if not cfg.enabled:
                raise VtonError("AI xizmati sozlanmagan")
            provider = PROVIDERS[cfg.provider](cfg)
            products = {p.pk: p for p in Product.objects.filter(pk__in=job.product_ids)}
            ordered = sorted(products.values(), key=lambda p: CHAIN_ORDER.index(SLOTS[p.kind]))
            if not ordered:
                raise VtonError("Kiyim tanlanmagan")
            current = _read(job.person_image)
            for product in ordered:
                current = provider.run(current, _garment_bytes(job, product), product)
            job.result_image.save(f"{job.pk}.jpg", ContentFile(_to_jpeg(current)), save=False)
            job.status = JobStatus.DONE
        except VtonError as e:
            job.status, job.error = JobStatus.FAILED, str(e)[:300]
        except Exception:
            log.exception("Fotorealistik ish xatosi")
            job.status, job.error = JobStatus.FAILED, "Kutilmagan xato, qaytadan urinib ko'ring"
        job.finished_at = timezone.now()
        job.save()
    finally:
        close_old_connections()


def start_job(job):
    if getattr(settings, "VTON_SYNC", False):
        run_job(job.pk)
    else:
        threading.Thread(target=run_job, args=(job.pk,), daemon=True, name=f"vton-{job.pk}").start()
