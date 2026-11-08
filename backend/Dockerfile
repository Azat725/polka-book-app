FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app/backend
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 10001 --create-home books
COPY backend/ ./
COPY infra/pdf-sandbox/parse_pdf.py /app/infra/pdf-sandbox/parse_pdf.py
RUN mkdir -p /private /jobs /app/backend/staticfiles && chown books:books /private /jobs /app/backend/staticfiles
USER 10001:10001
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "2", "--threads", "4", "--timeout", "90", "--access-logfile", "-", "--error-logfile", "-"]
