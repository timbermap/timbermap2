FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    libgdal-dev \
    gdal-bin \
    libgl1 \
    libglib2.0-0 \
    libspatialindex-dev \
    g++ \
    gcc \
    && rm -rf /var/lib/apt/lists/*

ENV GDAL_VERSION=3.6.4

WORKDIR /app

# Instalar todo junto con pins — pip resuelve conflictos en un solo pass
# numpy<2.0 es requerido por tensorflow 2.15
RUN pip install --no-cache-dir \
    "numpy>=1.23,<2.0" \
    "tensorflow==2.15.0" \
    "keras==2.15.0" \
    pandas \
    "GDAL==${GDAL_VERSION}" \
    rasterio \
    geopandas \
    shapely \
    fiona \
    pyproj \
    opencv-python-headless \
    scikit-image \
    rasterstats \
    rtree \
    geojson \
    psycopg2-binary \
    python-dotenv \
    google-cloud-storage \
    fastapi \
    uvicorn

COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
