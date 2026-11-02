FROM node:20-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_API_BASE=/api
ENV VITE_API_BASE=${VITE_API_BASE}
# Build-time only: Vite inlines this into the JavaScript bundle. Changing it
# means rebuilding and redeploying the image; there is no runtime switch.
# Anything other than the exact string "true" leaves the flag OFF.
ARG VITE_PATIENT_OVERVIEW_52=false
ENV VITE_PATIENT_OVERVIEW_52=${VITE_PATIENT_OVERVIEW_52}
ARG VITE_PATIENT_OVERVIEW_C=false
ENV VITE_PATIENT_OVERVIEW_C=${VITE_PATIENT_OVERVIEW_C}
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/ >/dev/null || exit 1
