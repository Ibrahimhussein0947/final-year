# NOT BUILT OR RUN YET: the CPU PyTorch wheel and the 470 MB model could not be downloaded on the development network.
# Build context: the repository root.   docker build -f infra/docker/ai.Dockerfile -t ethiotalent-ai .
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models
WORKDIR /srv
COPY apps/ai/requirements.txt .
# CPU-only PyTorch is far smaller than the default CUDA build.
RUN pip install --extra-index-url https://download.pytorch.org/whl/cpu torch \
 && pip install -r requirements.txt
COPY apps/ai/app ./app
ARG AI_MODEL=sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
ENV AI_MODEL=${AI_MODEL}
# Bake the model into the image so the service starts offline and a restart never re-downloads it.
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('${AI_MODEL}')"
RUN useradd -r -u 10001 ai && chown -R ai /models
USER ai
EXPOSE 8100
HEALTHCHECK --interval=20s --timeout=5s --start-period=60s --retries=5 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8100/health').status==200 else 1)"
CMD ["uvicorn", "app.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8100"]
