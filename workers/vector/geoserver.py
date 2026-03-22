"""
workers/shared/geoserver.py
Shared GeoServer REST client — copy into each worker directory via Dockerfile:
    COPY ../shared/geoserver.py .

Env vars required:
    GEOSERVER_URL       e.g. https://timbermap-geoserver-tjrp7tcqaa-uc.a.run.app
    GEOSERVER_PASSWORD  from Secret Manager geoserver-password
    DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD  — for PostGIS datastore wiring
"""

import os
import logging
import requests
from requests.auth import HTTPBasicAuth

log = logging.getLogger(__name__)

WORKSPACE = "timbermap"
POSTGIS_DATASTORE = "timbermap_postgis"


# ── Auth / URL helpers ────────────────────────────────────────────────────────

def _base() -> str:
    url = os.getenv("GEOSERVER_URL", "https://timbermap-geoserver-tjrp7tcqaa-uc.a.run.app")
    return f"{url.rstrip('/')}/geoserver/rest"


def _auth() -> HTTPBasicAuth:
    return HTTPBasicAuth("admin", os.getenv("GEOSERVER_PASSWORD", ""))


def _json_headers() -> dict:
    return {"Content-Type": "application/json", "Accept": "application/json"}


def _ok(r: requests.Response, *extra_codes: int) -> bool:
    return r.status_code in {200, 201, *extra_codes}


# ── Workspace ─────────────────────────────────────────────────────────────────

def ensure_workspace() -> None:
    url = f"{_base()}/workspaces/{WORKSPACE}"
    r = requests.get(url, auth=_auth(), headers=_json_headers(), timeout=120)
    if r.status_code == 404:
        r2 = requests.post(
            f"{_base()}/workspaces",
            json={"workspace": {"name": WORKSPACE}},
            auth=_auth(), headers=_json_headers(), timeout=120,
        )
        r2.raise_for_status()
        log.info("GeoServer workspace '%s' created.", WORKSPACE)


# ── PostGIS datastore (shared, used by all vector layers) ─────────────────────

def ensure_postgis_datastore() -> str:
    ensure_workspace()
    ds_url = f"{_base()}/workspaces/{WORKSPACE}/datastores/{POSTGIS_DATASTORE}"
    r = requests.get(ds_url, auth=_auth(), headers=_json_headers(), timeout=120)
    if _ok(r):
        return POSTGIS_DATASTORE

    host = os.getenv("DB_HOST_PUBLIC") or os.getenv("DB_HOST", "127.0.0.1")
    if host.startswith("/"):
        host = "127.0.0.1"

    payload = {
        "dataStore": {
            "name": POSTGIS_DATASTORE,
            "type": "PostGIS",
            "enabled": True,
            "connectionParameters": {
                "entry": [
                    {"@key": "host",                "$": host},
                    {"@key": "port",                "$": os.getenv("DB_PORT", "5432")},
                    {"@key": "database",            "$": os.getenv("DB_NAME", "timbermap")},
                    {"@key": "user",                "$": os.getenv("DB_USER", "postgres")},
                    {"@key": "passwd",              "$": os.getenv("DB_PASSWORD", "")},
                    {"@key": "dbtype",              "$": "postgis"},
                    {"@key": "schema",              "$": "vectors"},
                    {"@key": "Expose primary keys", "$": "true"},
                    {"@key": "validate connections","$": "true"},
                    {"@key": "max connections",     "$": "10"},
                ]
            },
        }
    }
    r2 = requests.post(
        f"{_base()}/workspaces/{WORKSPACE}/datastores",
        json=payload, auth=_auth(), headers=_json_headers(), timeout=120,
    )
    r2.raise_for_status()
    log.info("GeoServer PostGIS datastore '%s' created.", POSTGIS_DATASTORE)
    return POSTGIS_DATASTORE


# ── Raster layers ─────────────────────────────────────────────────────────────

def publish_raster_layer(image_id: str, cog_http_url: str) -> str:
    """
    Create a GeoTIFF CoverageStore + Coverage for a Cloud-Optimised GeoTIFF.
    Returns the fully-qualified layer name  'timbermap:raster_<image_id>'.
    """
    ensure_workspace()
    store_name = f"raster_{image_id.replace('-', '_')}"
    layer_name = store_name

    # 1. Create or update the CoverageStore
    store_payload = {
        "coverageStore": {
            "name":      store_name,
            "type":      "GeoTIFF",
            "enabled":   True,
            "url":       cog_http_url,
            "workspace": {"name": WORKSPACE},
        }
    }
    stores_url = f"{_base()}/workspaces/{WORKSPACE}/coveragestores"
    r = requests.post(stores_url, json=store_payload,
                      auth=_auth(), headers=_json_headers(), timeout=120)
    if not _ok(r):
        requests.put(f"{stores_url}/{store_name}", json=store_payload,
                     auth=_auth(), headers=_json_headers(), timeout=120)

    # 2. Auto-configure coverage from the store (GeoServer reads the file metadata)
    #    This is more reliable than manually specifying nativeName for COGs over HTTP.
    autoconfigure_url = f"{stores_url}/{store_name}/coverages"
    r2 = requests.post(
        autoconfigure_url,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        json={},   # empty body = let GeoServer auto-detect from the file
        auth=_auth(),
        timeout=120,
    )

    # If auto-configure fails (e.g. GeoServer can't read the COG), fall back to manual
    if not _ok(r2, 409):
        log.warning("Auto-configure failed (%s), trying manual coverage publish...", r2.status_code)
        cov_payload = {
            "coverage": {
                "name":       layer_name,
                "title":      layer_name,
                "nativeName": layer_name,
                "enabled":    True,
            }
        }
        r3 = requests.post(autoconfigure_url, json=cov_payload,
                           auth=_auth(), headers=_json_headers(), timeout=120)
        if not _ok(r3, 409):
            r3.raise_for_status()

    layer = f"{WORKSPACE}:{layer_name}"
    log.info("GeoServer raster layer published: %s", layer)
    return layer


def update_raster_layer_url(image_id: str, cog_http_url: str) -> None:
    """Update the COG URL on an existing CoverageStore (e.g. after transform)."""
    store_name = f"raster_{image_id.replace('-', '_')}"
    payload = {
        "coverageStore": {
            "name":    store_name,
            "type":    "GeoTIFF",
            "enabled": True,
            "url":     cog_http_url,
        }
    }
    r = requests.put(
        f"{_base()}/workspaces/{WORKSPACE}/coveragestores/{store_name}",
        json=payload, auth=_auth(), headers=_json_headers(), timeout=120,
    )
    if not _ok(r, 404):
        r.raise_for_status()


def delete_raster_layer(image_id: str) -> None:
    """Delete Coverage + CoverageStore. Non-fatal if they don't exist."""
    store_name = f"raster_{image_id.replace('-', '_')}"
    layer_name = store_name
    requests.delete(
        f"{_base()}/workspaces/{WORKSPACE}/coveragestores/{store_name}"
        f"/coverages/{layer_name}?recurse=true",
        auth=_auth(), timeout=120,
    )
    requests.delete(
        f"{_base()}/workspaces/{WORKSPACE}/coveragestores/{store_name}?recurse=true",
        auth=_auth(), timeout=120,
    )
    log.info("GeoServer raster layer deleted: %s", store_name)


# ── Vector layers ─────────────────────────────────────────────────────────────

def publish_vector_layer(vector_id: str, table_name: str, epsg: str = "4326") -> str:
    ds_name = ensure_postgis_datastore()
    layer_name = table_name

    srs = f"EPSG:{epsg}" if not str(epsg).startswith("EPSG") else epsg

    payload = {
        "featureType": {
            "name":        layer_name,
            "nativeName":  layer_name,
            "title":       layer_name,
            "enabled":     True,
            "srs":         srs,
            "nativeBoundingBox": {
                "minx": -180, "maxx": 180,
                "miny": -90,  "maxy": 90,
                "crs": "EPSG:4326",
            },
            "latLonBoundingBox": {
                "minx": -180, "maxx": 180,
                "miny": -90,  "maxy": 90,
                "crs": "EPSG:4326",
            },
        }
    }
    ft_url = f"{_base()}/workspaces/{WORKSPACE}/datastores/{ds_name}/featuretypes"
    r = requests.post(ft_url, json=payload,
                      auth=_auth(), headers=_json_headers(), timeout=120)
    if not _ok(r, 409):
        r.raise_for_status()

    layer = f"{WORKSPACE}:{layer_name}"
    log.info("GeoServer vector layer published: %s", layer)
    return layer


def delete_vector_layer(vector_id: str) -> None:
    """Delete the FeatureType for a vector. Keeps the shared PostGIS datastore."""
    table_name = f"vec_{vector_id.replace('-', '_')}"
    requests.delete(
        f"{_base()}/workspaces/{WORKSPACE}/datastores/{POSTGIS_DATASTORE}"
        f"/featuretypes/{table_name}?recurse=true",
        auth=_auth(), timeout=120,
    )
    log.info("GeoServer vector layer deleted: %s", table_name)


# ── GCS URL helper ───────────────────────────────────────────────────────────

def generate_cog_signed_url(gcs_path: str, bucket_name: str,
                             expiry_seconds: int = 604800) -> str:
    """
    Returns a gs:// URI for use with GeoServer + GCS Community Plugin.
    GeoServer reads the COG directly from GCS using the service account credentials.
    """
    return f"gs://{bucket_name}/{gcs_path}"
