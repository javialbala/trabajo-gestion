# Imagen oficial de Node.js 20 de Red Hat (la que usa OpenShift)
FROM registry.access.redhat.com/ubi9/nodejs-20

# 1. Instalar dependencias a partir de package.json / package-lock.json
COPY --chown=1001:0 backend/package*.json backend/
RUN cd backend && npm ci --omit=dev

# 2. Copiar el código de la app (backend + frontend)
COPY --chown=1001:0 backend/src backend/src
COPY --chown=1001:0 frontend frontend

ENV PORT=3000
EXPOSE 3000
CMD ["node", "backend/src/index.js"]
