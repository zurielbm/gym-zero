FROM node:22-alpine AS build
WORKDIR /app
# URLs of the self-hosted Convex deployment (API + site origin serving
# /api/auth/*); leave both unset for a local-only, login-free build
ARG VITE_CONVEX_URL
ARG VITE_CONVEX_SITE_URL
# how barcode lookups identify this deployment to Open Food Facts (optional)
ARG VITE_OFF_APP_NAME
ENV VITE_CONVEX_URL=$VITE_CONVEX_URL
ENV VITE_CONVEX_SITE_URL=$VITE_CONVEX_SITE_URL
ENV VITE_OFF_APP_NAME=$VITE_OFF_APP_NAME
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
