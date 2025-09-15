# PRD — RMIT Store CI/CD on Kubernetes (k3s) + Docker Hub (Production Only, No DNS)

## Scope

Staging and Production deployment of the MERN-based RMIT Store on Kubernetes (k3s) using five EC2 instances and Docker Hub as the image registry. No DNS (access via http://<MASTER_PUBLIC_IP>). Frontend pods must run on a dedicated Client node, backend pods on a dedicated Server node. Deployments use blue-green strategy with Jenkins CI/CD. Staging runs in a separate Kubernetes namespace (`staging`) on the same cluster and is exposed under path prefixes (`/staging` for FE, `/staging/api` for BE).

## 1) Objectives & Non-Goals
### Objectives

- Automate build → test → scan → push → deploy (green) → validate → cutover (blue→green) → notify.
- Enforce node separation:
  - Frontend pods → Client worker node.
  - Backend pods → Server worker node.
- Support instant rollback (switch back to blue).
- Keep infra simple and low-cost under a student budget.

### Non-Goals

- No DNS or TLS (access via http://<MASTER_PUBLIC_IP>).
- No managed EKS (k3s is used).

## 2) Final Topology (5× EC2)

| EC2 # | Role              | What runs |
| ----- | ----------------- | --------- |
| 1     | Jenkins           | Dockerized Jenkins controller for CI/CD, pushes to Docker Hub, deploys to k3s |
| 2     | MongoDB           | Single VM running Mongo 6 container (production DB) on :27017 |
| 3     | k3s Master        | k3s server (control plane) + Traefik Ingress; prod namespace; public entrypoint on ports 80/443 |
| 4     | Client (FE worker)| k3s agent labeled tier=frontend (schedules frontend pods) |
| 5     | Server (BE worker)| k3s agent labeled tier=backend (schedules backend pods) |

Access: Open browser to http://<MASTER_PUBLIC_IP>/ (production frontend) and http://<MASTER_PUBLIC_IP>/api/health (production backend). Staging is reachable at http://<MASTER_PUBLIC_IP>/staging (frontend) and http://<MASTER_PUBLIC_IP>/staging/api/health (backend).

## 3) Networking & Security

- Jenkins SG: allow TCP 22 (your IP), 8080 (your IP).
- k3s Master SG: allow TCP 22 (your IP), 80/443 (world), 6443 (from Jenkins + workers’ SG).
- Client / Server SGs: allow TCP 22 (your IP). (Cluster ports are opened via SG-to-SG rules to Master.)
- MongoDB SG: allow 27017/tcp only from k3s Master + Client + Server SGs (no public access).

## 4) External Dependencies

- Docker Hub: two private repos:
  - rmit-store-frontend
  - rmit-store-backend
- Docker Hub PAT: store in Jenkins credentials (dockerhub).
- Node 18 + npm: for local builds/tests.
- GitHub: repo with Jenkinsfile, Dockerfiles, Helm chart, tests.

## 5) Acceptance Criteria

- Push to GitHub triggers Jenkins; builds images; pushes to Docker Hub (private); deploys to STAGING; validates STAGING; deploys GREEN alongside BLUE in PROD; validates; flips PROD services to GREEN.
- kubectl -n prod get pods -o wide shows:
  - Frontend pods on Client node.
  - Backend pods on Server node.
- curl http://<MASTER_PUBLIC_IP>/api/health returns 200.
- curl http://<MASTER_PUBLIC_IP>/staging/api/health returns 200.
- Rollback via kubectl patch service … activeColor=blue restores previous version instantly.

## 6) Detailed Implementation Plan
### 6.1 Provision EC2 (Ubuntu 22.04, t3.micro)

- Create five instances as per roles above.
- Attach security groups per §3.
- Note private IP of Mongo EC2 for MONGODB_URI.

### 6.2 MongoDB VM (EC2 #2)

```bash
sudo apt update && sudo apt -y install docker.io
sudo systemctl enable --now docker

docker volume create mongo_prod
docker run -d --name mongo-prod \
  -p 27017:27017 \
  -v mongo_prod:/data/db \
  --restart unless-stopped \
  mongo:6
```

Production URI: mongodb://<MONGO_PRIVATE_IP>:27017/rmit

### 6.3 k3s Cluster (EC2 #3 Master, #4 Client, #5 Server)

#### On Master (EC2 #3)

```bash
sudo apt update && sudo apt -y install curl
curl -sfL https://get.k3s.io | sh -s -   # installs k3s + Traefik Ingress
sudo kubectl get nodes
sudo cp /etc/rancher/k3s/k3s.yaml /root/kubeconfig.yaml && sudo chmod 600 /root/kubeconfig.yaml
sudo kubectl create ns prod
sudo cat /var/lib/rancher/k3s/server/node-token   # save TOKEN
```

#### On Client (EC2 #4)

```bash
MASTER_IP=<MASTER_PRIVATE_IP>
TOKEN=<TOKEN_FROM_MASTER>
curl -sfL https://get.k3s.io | K3S_URL=https://$MASTER_IP:6443 K3S_TOKEN=$TOKEN sh -
```

#### On Server (EC2 #5)

```bash
MASTER_IP=<MASTER_PRIVATE_IP>
TOKEN=<TOKEN_FROM_MASTER>
curl -sfL https://get.k3s.io | K3S_URL=https://$MASTER_IP:6443 K3S_TOKEN=$TOKEN sh -
```

#### Back on Master — label nodes

```bash
kubectl get nodes
kubectl label node <client-node-name> tier=frontend
kubectl label node <server-node-name> tier=backend
```

Traefik’s k3s Service binds ports 80/443 on the Master’s node IP. No DNS needed; use http://<MASTER_PUBLIC_IP>.

### 6.4 Jenkins (EC2 #1)

```bash
docker volume create jenkins_home
docker run -d --name jenkins \
  -p 8080:8080 -p 50000:50000 \
  -v jenkins_home:/var/jenkins_home \
  -v /var/run/docker.sock:/var/run/docker.sock \
  jenkins/jenkins:lts
docker logs jenkins | sed -n 's/.*password: //p' | head -1
```

#### Jenkins setup

- Plugins: Git, Pipeline, Blue Ocean, Docker, Docker Pipeline, Kubernetes CLI, Email Extension (optional).
- Credentials:
  - dockerhub (username + PAT).
  - kubeconfig-master: upload /root/kubeconfig.yaml from Master.
- GitHub → Webhook: http://<JENKINS_PUBLIC_IP>:8080/github-webhook/ (push events).

### 6.5 Repository Changes
#### 6.5.1 Dockerfiles

##### server/Dockerfile

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV PORT=3000
EXPOSE 3000
CMD ["npm","start"]
```

##### client/Dockerfile

```dockerfile
FROM node:18-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
```

#### 6.5.2 Tests (3 layers)

- Unit (backend/Jest): utilities/controllers.
- Integration/API (Jest + Supertest): spin a Mongo test container in Jenkins (mongo:6 on 27018), test /api/products, auth flows.
- E2E (Playwright): target BASE_URL=http://<MASTER_PUBLIC_IP>; validate:
  - Products render on /
  - Login/Logout
  - Add-to-cart → basic checkout flow (mock/skip payments if not implemented)

### 6.6 Docker Hub Pull Secret (prod namespace)

```bash
kubectl -n prod create secret docker-registry dockerhub-regcred \
  --docker-server=https://index.docker.io/v1/ \
  --docker-username='<DOCKERHUB_USER_OR_ORG>' \
  --docker-password='<DOCKERHUB_PAT>' \
  --docker-email='you@example.com'

kubectl -n prod patch serviceaccount default \
  -p '{"imagePullSecrets":[{"name":"dockerhub-regcred"}]}'
```

### 6.7 Helm Chart (blue-green + node pinning)

#### Structure

```text
helm/rmit-store/
  Chart.yaml
  values-prod.yaml
  values-staging.yaml
  templates/
    secret.yaml
    backend-deploy-blue.yaml
    backend-deploy-green.yaml
    backend-svc.yaml
    backend-ingress.yaml
    backend-ingress-staging.yaml
    frontend-deploy-blue.yaml
    frontend-deploy-green.yaml
    frontend-svc.yaml
    frontend-ingress.yaml
    frontend-ingress-staging.yaml
```

#### templates/secret.yaml

```yaml
apiVersion: v1
kind: Secret
metadata: { name: app-secrets }
type: Opaque
stringData:
  MONGODB_URI: {{ .Values.mongo.uri | quote }}
  JWT_SECRET:  {{ .Values.backend.env.JWT_SECRET | quote }}
```

#### Backend (blue) — templates/backend-deploy-blue.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: backend-blue, labels: { app: backend, activeColor: blue } }
spec:
  replicas: {{ .Values.backend.replicas | default 1 }}
  selector: { matchLabels: { app: backend, activeColor: blue } }
  template:
    metadata: { labels: { app: backend, activeColor: blue } }
    spec:
      nodeSelector: { tier: backend }
      containers:
      - name: backend
        image: {{ .Values.backend.blueImage | default .Values.backend.image | quote }}
        ports: [{ containerPort: 3000 }]
        env:
        - { name: MONGODB_URI, valueFrom: { secretKeyRef: { name: app-secrets, key: MONGODB_URI } } }
        - { name: JWT_SECRET,  valueFrom: { secretKeyRef: { name: app-secrets, key: JWT_SECRET  } } }
        - { name: PORT, value: "3000" }
        readinessProbe: { httpGet: { path: /api/health, port: 3000 }, initialDelaySeconds: 5, periodSeconds: 5 }
        livenessProbe:  { httpGet: { path: /api/health, port: 3000 }, initialDelaySeconds: 15, periodSeconds: 10 }
```

Backend (green) — templates/backend-deploy-green.yaml (same but activeColor: green and image from .Values.backend.greenImage).

#### Backend Service — templates/backend-svc.yaml

```yaml
apiVersion: v1
kind: Service
metadata: { name: backend }
spec:
  selector:
    app: backend
    activeColor: {{ .Values.backend.activeColor | default "blue" }}
  ports: [{ port: 3000, targetPort: 3000 }]
  type: ClusterIP
```

#### Backend Ingress (no host) — templates/backend-ingress.yaml

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: backend
  annotations: { kubernetes.io/ingress.class: "traefik" }
spec:
  rules:
  - http:
      paths:
      - path: /api
        pathType: Prefix
        backend: { service: { name: backend, port: { number: 5000 } } }
```

#### Backend Ingress (staging path) — templates/backend-ingress-staging.yaml

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: backend-staging
  annotations: { kubernetes.io/ingress.class: "traefik" }
spec:
  rules:
  - http:
      paths:
      - path: /staging/api
        pathType: Prefix
        backend: { service: { name: backend, port: { number: 3000 } } }
```

#### Frontend (blue) — templates/frontend-deploy-blue.yaml

```yaml
apiVersion: apps/v1
kind: Deployment
metadata: { name: frontend-blue, labels: { app: frontend, activeColor: blue } }
spec:
  replicas: {{ .Values.frontend.replicas | default 1 }}
  selector: { matchLabels: { app: frontend, activeColor: blue } }
  template:
    metadata: { labels: { app: frontend, activeColor: blue } }
    spec:
      nodeSelector: { tier: frontend }
      containers:
      - name: frontend
        image: {{ .Values.frontend.blueImage | default .Values.frontend.image | quote }}
        ports: [{ containerPort: 80 }]
```

#### Frontend (green) — templates/frontend-deploy-green.yaml (same with activeColor: green and green image)

#### Frontend Service — templates/frontend-svc.yaml

```yaml
apiVersion: v1
kind: Service
metadata: { name: frontend }
spec:
  selector:
    app: frontend
    activeColor: {{ .Values.frontend.activeColor | default "blue" }}
  ports: [{ port: 80, targetPort: 80 }]
  type: ClusterIP
```

#### Frontend Ingress (no host) — templates/frontend-ingress.yaml

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: frontend
  annotations: { kubernetes.io/ingress.class: "traefik" }
spec:
  rules:
  - http:
      paths:
      - path: /
        pathType: Prefix
        backend: { service: { name: frontend, port: { number: 80 } } }
```

#### Frontend Ingress (staging path) — templates/frontend-ingress-staging.yaml

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: frontend-staging
  annotations: { kubernetes.io/ingress.class: "traefik" }
spec:
  rules:
  - http:
      paths:
      - path: /staging
        pathType: Prefix
        backend: { service: { name: frontend, port: { number: 80 } } }
```

#### Values — values-prod.yaml

```yaml
mongo:
  uri: "mongodb://<MONGO_PRIVATE_IP>:27017/rmit"

backend:
  image: "docker.io/<ns>/rmit-store-backend:latest"  # used only if blue/green not set
  blueImage:  "docker.io/<ns>/rmit-store-backend:<OLD_TAG>"
  greenImage: "docker.io/<ns>/rmit-store-backend:<NEW_TAG>"
  env: { JWT_SECRET: "prodsecret" }
  replicas: 1
  activeColor: "blue"
  port: 3000

frontend:
  image: "docker.io/<ns>/rmit-store-frontend:latest"
  blueImage:  "docker.io/<ns>/rmit-store-frontend:<OLD_TAG>"
  greenImage: "docker.io/<ns>/rmit-store-frontend:<NEW_TAG>"
  replicas: 1
  activeColor: "blue"
  port: 80
```

#### Values — values-staging.yaml

```yaml
mongo:
  uri: "mongodb://<MONGO_PRIVATE_IP>:27017/rmit"

backend:
  image: "docker.io/<ns>/rmit-store-backend:latest"
  blueImage:  "docker.io/<ns>/rmit-store-backend:<OLD_TAG>"
  greenImage: "docker.io/<ns>/rmit-store-backend:<NEW_TAG>"
  env: { JWT_SECRET: "stagingsecret" }
  replicas: 1
  activeColor: "blue"
  port: 3000

frontend:
  image: "docker.io/<ns>/rmit-store-frontend:latest"
  blueImage:  "docker.io/<ns>/rmit-store-frontend:<OLD_TAG>"
  greenImage: "docker.io/<ns>/rmit-store-frontend:<NEW_TAG>"
  replicas: 1
  activeColor: "blue"
  port: 80
```

### 6.8 Initial Staging + Production Deploy

```bash
# on Master
curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Create namespaces
kubectl create ns staging || true
kubectl create ns prod || true

# For first deploy, you can set blueImage=greenImage to the same known-good tag
helm upgrade --install rmit-store-staging ./helm/rmit-store \
  -n staging -f ./helm/values-staging.yaml

helm upgrade --install rmit-store ./helm/rmit-store \
  -n prod -f ./helm/values-prod.yaml

kubectl -n prod get deploy,svc,ingress,pods -o wide
# Verify FE on Client node, BE on Server node (check NODE column)
```

Access the production site: http://<MASTER_PUBLIC_IP>/

Production API health: http://<MASTER_PUBLIC_IP>/api/health

Access the staging site: http://<MASTER_PUBLIC_IP>/staging

Staging API health: http://<MASTER_PUBLIC_IP>/staging/api/health

## 7) CI/CD (Jenkins) — Docker Hub + Blue-Green
### 7.1 Jenkinsfile (root of repo)

```groovy
pipeline {
  agent any
  environment {
    DH_NS     = '<your-dockerhub-username-or-org>'
    FRONT_IMG = "docker.io/${DH_NS}/rmit-store-frontend"
    BACK_IMG  = "docker.io/${DH_NS}/rmit-store-backend"
    BASE_URL  = "http://<MASTER_PUBLIC_IP>"
  }
  triggers { githubPush() }

  stages {
    stage('Checkout'){ steps { checkout scm } }

    stage('Deploy STAGING'){
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-master', variable: 'KUBECONF')]){
          sh """
            export KUBECONFIG=$KUBECONF
            helm upgrade --install rmit-store-staging ./helm/rmit-store -n staging \
              --set backend.greenImage=${BACK_IMG}:${GIT_COMMIT} \
              --set frontend.greenImage=${FRONT_IMG}:${GIT_COMMIT} \
              --set backend.activeColor=blue --set frontend.activeColor=blue \
              -f ./helm/values-staging.yaml

            kubectl -n staging rollout status deploy/backend-green --timeout=120s || true
            kubectl -n staging rollout status deploy/frontend-green --timeout=120s || true
          """
        }
      }
    }

    stage('Smoke STAGING'){
      steps {
        sh """
          curl -sSf ${BASE_URL}/staging/api/health
        """
      }
    }

    stage('Backend: Lint + Unit'){
      steps { dir('backend'){ sh 'npm ci && npm run lint || true && npm test -- --ci' } }
    }

    stage('Backend: Integration (API)'){
      steps {
        dir('backend'){
          sh 'docker run -d --rm --name testmongo -p 27018:27017 mongo:6'
          sh 'MONGODB_URI=mongodb://localhost:27018/rmit npm run test:api'
          sh 'docker stop testmongo'
        }
      }
    }

    stage('Build images'){
      steps {
        sh """
          docker build -t ${BACK_IMG}:${GIT_COMMIT}  ./backend
          docker build -t ${FRONT_IMG}:${GIT_COMMIT} ./frontend
        """
      }
    }

    stage('Push to Docker Hub'){
      steps {
        withCredentials([usernamePassword(credentialsId: 'dockerhub', usernameVariable: 'DH_USER', passwordVariable: 'DH_TOKEN')]) {
          sh """
            echo "$DH_TOKEN" | docker login -u "$DH_USER" --password-stdin
            docker push ${BACK_IMG}:${GIT_COMMIT}
            docker push ${FRONT_IMG}:${GIT_COMMIT}
          """
        }
      }
    }

    stage('Deploy GREEN (prod)'){
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-master', variable: 'KUBECONF')]){
          sh """
            export KUBECONFIG=$KUBECONF
            helm upgrade --install rmit-store ./helm/rmit-store -n prod \
              --set backend.greenImage=${BACK_IMG}:${GIT_COMMIT} \
              --set frontend.greenImage=${FRONT_IMG}:${GIT_COMMIT} \
              --set backend.activeColor=blue --set frontend.activeColor=blue \
              -f ./helm/values-prod.yaml

            kubectl -n prod rollout status deploy/backend-green --timeout=120s
            kubectl -n prod rollout status deploy/frontend-green --timeout=120s
          """
        }
      }
    }

    stage('Smoke GREEN'){
      steps {
        sh """
          curl -sSf ${BASE_URL}/api/health
          # Optionally hit a non-root path that forces FE to proxy API
        """
      }
    }

    stage('Cutover BLUE -> GREEN'){
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-master', variable: 'KUBECONF')]){
          sh """
            export KUBECONFIG=$KUBECONF
            kubectl -n prod patch service backend  -p '{"spec":{"selector":{"app":"backend","activeColor":"green"}}}'
            kubectl -n prod patch service frontend -p '{"spec":{"selector":{"app":"frontend","activeColor":"green"}}}'
          """
        }
      }
    }
  }

  post {
    success {
      echo "Deployment succeeded: ${GIT_COMMIT}"
    }
    failure {
      echo "Deployment failed at stage: ${env.STAGE_NAME}"
    }
  }
}
```

### Rollback (manual)

```bash
kubectl -n prod patch service backend -p '{"spec":{"selector":{"app":"backend","activeColor":"blue"}}}'
kubectl -n prod patch service frontend -p '{"spec":{"selector":{"app":"frontend","activeColor":"blue"}}}'
```

## 8) Validation Checklist

- kubectl -n prod get pods -o wide shows frontend on Client node, backend on Server node.
- curl http://<MASTER_PUBLIC_IP>/api/health → 200.
- Pushing code runs Jenkins → images pushed to Docker Hub (private).
- Helm upgrade deploys green; rollout succeeds; services patched to green.
- Website reachable at http://<MASTER_PUBLIC_IP>/.

## 9) Risks & Mitigations

- No TLS/DNS: Plain HTTP; acceptable per scope. Future: cert-manager + Let’s Encrypt + DNS.
- Single Mongo VM: No replica set; acceptable for assignment. Future: managed DB or RS.
- Single k3s master: SPOF control plane; acceptable for assignment. Future: HA masters.
- Secrets: Stored in K8s Secrets (base64-encoded). Future: external secrets/ASM.

## 10) Repository Layout (suggested)

```text
.
├─ server/
│  ├─ Dockerfile
│  └─ tests/            # unit + integration
├─ client/
│  └─ Dockerfile
├─ helm/
│  └─ rmit-store/
│     ├─ Chart.yaml
│     ├─ values-prod.yaml
│     └─ templates/
│        ├─ secret.yaml
│        ├─ backend-deploy-blue.yaml
│        ├─ backend-deploy-green.yaml
│        ├─ backend-svc.yaml
│        ├─ backend-ingress.yaml
│        ├─ frontend-deploy-blue.yaml
│        ├─ frontend-deploy-green.yaml
│        ├─ frontend-svc.yaml
│        └─ frontend-ingress.yaml
├─ tests/
│  └─ e2e-playwright/   # smoke specs using BASE_URL=http://<MASTER_PUBLIC_IP>
└─ Jenkinsfile
```

## 11) Operations (common commands)

### Inspect cluster + workloads

```bash
kubectl get nodes -o wide
kubectl -n prod get deploy,svc,ingress,pods -o wide
kubectl -n prod logs deploy/backend-green
```

### Flip traffic

```bash
kubectl -n prod patch service backend  -p '{"spec":{"selector":{"app":"backend","activeColor":"green"}}}'
kubectl -n prod patch service frontend -p '{"spec":{"selector":{"app":"frontend","activeColor":"green"}}}'
```

### Rollback

```bash
kubectl -n prod patch service backend  -p '{"spec":{"selector":{"app":"backend","activeColor":"blue"}}}'
kubectl -n prod patch service frontend -p '{"spec":{"selector":{"app":"frontend","activeColor":"blue"}}}'
```

### Health checks

```bash
curl http://<MASTER_PUBLIC_IP>/api/health
```


