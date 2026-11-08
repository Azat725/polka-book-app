FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends bubblewrap && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pypdfium2==5.15.1 Pillow==13.0.0
RUN useradd --uid 10001 --create-home sandbox
WORKDIR /app
COPY infra/pdf-sandbox/parse_pdf.py infra/pdf-sandbox/runner.py /app/
USER 10001:10001
ENV PDF_JOB_ROOT=/jobs
CMD ["python", "-I", "/app/runner.py"]
