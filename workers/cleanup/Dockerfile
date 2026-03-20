FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install fastapi uvicorn psycopg2-binary sqlalchemy geoalchemy2 \
    google-cloud-storage google-cloud-pubsub python-dotenv requests
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
