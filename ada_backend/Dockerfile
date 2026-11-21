FROM python:3.11-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

ENV SKIN_CLASS_ORDER=acne,wrinkles,dry,normal,oily
ENV SKIN_MODEL_PATH=/models/resnet50_v2_fold1.pth

EXPOSE 8001
CMD ["uvicorn", "server:app_socketio", "--host", "0.0.0.0", "--port", "8001"]

