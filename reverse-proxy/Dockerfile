FROM nginx:1.29.3-alpine
# Copy nginx config and certificates (provide your own self-signed or real certs)
COPY ./nginx.conf /etc/nginx/conf.d/default.conf
COPY ./certs/tiNi-Wifi.crt /etc/nginx/certs/tiNi-Wifi.crt
COPY ./certs/tiNi-Wifi.key /etc/nginx/certs/tiNi-Wifi.key
EXPOSE 80 443