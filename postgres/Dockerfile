FROM postgres:16-alpine
RUN apk add --no-cache python3
COPY port_check.py /usr/local/bin/port_check.py
COPY auth_check.py /usr/local/bin/auth_check.py
COPY start.py /usr/local/bin/dashboard-start.py
COPY wait-ready.sh /usr/local/bin/wait-ready.sh
COPY pg_hba.conf /etc/postgresql/dashboard-pg_hba.conf
EXPOSE 5434
ENTRYPOINT ["python3", "/usr/local/bin/dashboard-start.py"]
