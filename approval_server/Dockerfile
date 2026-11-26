FROM node:22-alpine AS build
WORKDIR /src
COPY package.json index.html ./
COPY assets assets
COPY src src
COPY scripts scripts
RUN npm run build

FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1
COPY approval_server/requirements.txt /tmp/requirements.txt
RUN pip install --no-cache-dir -r /tmp/requirements.txt && useradd --uid 10001 --create-home app && mkdir /data && chown app:app /data
COPY approval_server /app/approval_server
COPY --from=build /src/dist /app/dist
USER app
ENV PAYMENTS_DB=/data/approval.sqlite3
EXPOSE 8080
CMD ["waitress-serve","--listen=0.0.0.0:8080","--call","approval_server.app:create_app"]
