import os
from geo.Geoserver import Geoserver

def get_geoserver() -> Geoserver:
    url = os.getenv("GEOSERVER_URL", "http://localhost:8080/geoserver")
    user = os.getenv("GEOSERVER_USER", "admin")
    password = os.getenv("GEOSERVER_PASSWORD", "geoserver")
    return Geoserver(url, username=user, password=password)

WORKSPACE = "timbermap"

def ensure_workspace(geo: Geoserver):
    try:
        geo.create_workspace(workspace=WORKSPACE)
    except Exception:
        pass  # Already exists

def publish_postgis_layer(
    layer_name: str,
    table_name: str,
    schema: str,
    epsg: str,
    title: str = None
):
    geo = get_geoserver()
    ensure_workspace(geo)

    db_host = os.getenv("DB_HOST", "localhost")
    db_name = os.getenv("DB_NAME", "timbermap")
    db_user = os.getenv("DB_USER", "postgres")
    db_password = os.getenv("DB_PASSWORD", "")
    db_port = os.getenv("DB_PORT", "5432")

    store_name = f"postgis_{schema}"

    # Create PostGIS datastore if not exists
    try:
        geo.create_featurestore(
            store_name=store_name,
            workspace=WORKSPACE,
            db=db_name,
            host=db_host,
            port=int(db_port),
            pg_user=db_user,
            pg_password=db_password,
            schema=schema,
        )
    except Exception:
        pass  # Store may already exist

    # Publish layer from PostGIS table
    geo.publish_featurestore(
        workspace=WORKSPACE,
        store_name=store_name,
        pg_table=table_name,
    )

    return f"{WORKSPACE}:{layer_name}"

def publish_geotiff_layer(
    layer_name: str,
    gcs_url: str,
    epsg: str,
):
    geo = get_geoserver()
    ensure_workspace(geo)

    geo.create_coveragestore(
        layer_name=layer_name,
        workspace=WORKSPACE,
        path=gcs_url,
        file_type="GeoTIFF",
    )

    return f"{WORKSPACE}:{layer_name}"

def delete_layer(layer_name: str):
    geo = get_geoserver()
    try:
        geo.delete_layer(layer_name=layer_name, workspace=WORKSPACE)
    except Exception:
        pass
    try:
        geo.delete_coveragestore(
            coveragestore_name=layer_name, workspace=WORKSPACE
        )
    except Exception:
        pass

def get_wms_url(layer_name: str) -> str:
    base = os.getenv("GEOSERVER_URL", "http://localhost:8080/geoserver")
    return (
        f"{base}/{WORKSPACE}/wms?"
        f"SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap"
        f"&LAYERS={WORKSPACE}:{layer_name}"
        f"&BBOX={{bbox-epsg-3857}}"
        f"&WIDTH=256&HEIGHT=256"
        f"&SRS=EPSG:3857"
        f"&FORMAT=image/png"
        f"&TRANSPARENT=true"
    )
