## Observability & Alerts

### Stack
- kube‑prometheus‑stack (Prometheus, Grafana, Alertmanager)
- Grafana ingress (TLS via cert‑manager); admin password via Ansible var
- ServiceMonitor (optional toggle in Helm chart) scrapes backend `/metrics`
- PrometheusRule: pod restarts, Traefik 5xx rate, certificate expiry

### Email Alerts
- Alertmanager SMTP configured via Ansible vars: `smtp_smarthost`, `smtp_from`, `smtp_username`, `smtp_password`, `email_to`

### Dashboards
- Built‑in Kubernetes dashboards; custom app dashboards (App SLO, Blue/Green, Mongo) via ConfigMaps


