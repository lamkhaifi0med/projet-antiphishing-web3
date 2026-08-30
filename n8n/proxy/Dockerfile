FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY n8n/proxy/nginx.conf /etc/nginx/nginx.conf
COPY n8n/portal/index.html /usr/share/nginx/html/index.html
EXPOSE 8080
