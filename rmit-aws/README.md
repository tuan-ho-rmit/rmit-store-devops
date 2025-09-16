# RMIT AWS Infrastructure (Ansible)

This folder provisions AWS infrastructure and configures the stack end-to-end with Ansible:
- VPC and EC2 instances for Jenkins, k3s master/workers, and MongoDB
- Jenkins (Docker, JCasC, pipeline, credentials)
- k3s master with kubeconfig rewritten to the master private IP (exported to Jenkins)
- MongoDB (containerized) with one-time data seeding

The Makefile orchestrates the full flow so you can run everything with a single command.

## Prerequisites
- AWS account and credentials
- Tools on the controller machine:
  - make, ansible, python3, ssh, rsync
  - awscli (v2 recommended)
- An EC2 SSH key pair PEM file available locally in this folder

### Set AWS credentials (shell exports)
Use an IAM user/role with permissions to create VPC/EC2/Security Groups, etc.

```bash
export AWS_ACCESS_KEY_ID=AKIA...           # required
export AWS_SECRET_ACCESS_KEY=...           # required
export AWS_SESSION_TOKEN=...               # required if using temporary credentials
export AWS_REGION=us-east-1                # or your region

# Verify credentials
aws sts get-caller-identity
```

### Python virtual environment and dependencies
The Makefile auto-detects `.venv/bin/python` and uses it. Create and populate it:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install "ansible>=9.0.0" boto3 botocore awscli

# Install required Ansible Galaxy collections
ansible-galaxy collection install -r ansible/requirements.yml
```

If you prefer not to activate the venv, the Makefile will still pick it up via the interpreter path.

## Quick start (one command)
1) Create a `.env` file in this directory with your settings:

```bash
# AWS
AWS_REGION=us-east-1

# EC2 SSH key (basename; the Makefile expects ./<EC2_KEY_NAME>.pem here)
EC2_KEY_NAME=rmit-ec2

# Docker Hub credentials used by Jenkins
DOCKERHUB_USER=your_dockerhub_username
DOCKERHUB_PAT=your_dockerhub_pat

# GitHub repo that contains the Jenkinsfile (this repo)
GITHUB_OWNER=your_github_owner
GITHUB_REPO=rmit-store-devops
GITHUB_TOKEN=ghp_xxx   # token with repo read access

# Optional: if you know the external Jenkins URL (otherwise auto-derived)
JENKINS_URL_HINT=http://<jenkins-public-ip>:8080/
```

Also copy your PEM into this folder, named `./${EC2_KEY_NAME}.pem`.

2) Run the full flow:

```bash
# Optional but useful: export all vars from .env to this shell
set -a; . ./.env; set +a

make up
```

This will:
- Provision AWS (unless SKIP_PROVISION=1)
- Write `ec2-outputs.env`
- Generate `ansible/inventory.ini` and `ansible/group_vars/all.yaml`
- Run the Ansible site playbook to configure all hosts

When it finishes, Jenkins should be reachable at the printed URL and already configured to run the pipeline on this repository.

## Step-by-step targets
If you prefer explicit steps:

```bash
# 1) Provision AWS resources and emit outputs
make provision-aws

# 2) Copy outputs to ./ec2-outputs.env
make outputs

# 3) Generate inventory and group vars from outputs + .env
make inventory

# 4) (optional) Wait for EC2 instance status checks to pass
make aws-wait

# 5) (optional) SSH preflight to all instances
make preflight

# 6) Configure hosts with Ansible (Jenkins, k3s, Mongo, etc.)
make provision
```

## Useful variables and flags
Set in `.env`:
- AWS_REGION, EC2_KEY_NAME, DOCKERHUB_USER, DOCKERHUB_PAT
- GITHUB_OWNER, GITHUB_REPO, GITHUB_TOKEN, JENKINS_URL_HINT

To export them into your current shell session (optional):

```bash
set -a; . ./.env; set +a
```

Make flags:
- `SKIP_PROVISION=1` — use existing infrastructure (requires an `ec2-outputs.env`)
- `SKIP_MONGO=0` — include the Mongo role during `make provision` (default is 1 to skip)
- `CHECK_MONGO_SSH=1` — also preflight SSH to the Mongo host
- `SKIP_AWS_WAIT=1` — skip instance status checks in `make aws-wait`

Examples:
```bash
SKIP_PROVISION=1 make up
SKIP_MONGO=0 make provision
```

## What Ansible configures
- Jenkins host: Docker, Docker group mapping inside the Jenkins container, JCasC, credentials (Docker Hub, GitHub, kubeconfig), pipeline job
- k3s master: cluster and kubeconfig rewritten to master private IP and stored as Jenkins file credential (`kubeconfig-master`)
- MongoDB host: containerized Mongo and one-time DB seed (idempotent)
- Security groups: inbound rules including your controller public IP for SSH

## Rerun a subset
Limit a run to a host/group:

```bash
ANSIBLE_HOST_KEY_CHECKING=False \
ansible-playbook -i ansible/inventory.ini ansible/site.yaml --limit jenkins
```

## Troubleshooting
- SSH preflight fails: your public IP may not be whitelisted in the Security Group. Re-run `make provision-aws` (updates rules) or adjust the SG.
- Docker permission denied in Jenkins pipeline: the role maps the Docker group GID into the Jenkins container and adds the `jenkins` user. If you changed Docker on the host, re-run with `--limit jenkins` or restart the Jenkins container.
- k3s API connection refused from Jenkins: kubeconfig is auto-rewritten to use the master private IP; re-run with `--limit k3s_master` if you recreated the cluster.
- Helm ServiceMonitor CRD errors: monitoring is disabled by default in chart values.
- Pods Pending on k8s: chart nodeSelector is optional; pods schedule on any node. To pin, set `backend.nodeSelector` or `frontend.nodeSelector` in Helm values.

## Files to know
- `ansible/provision-aws.yaml`: AWS resources and security groups
- `ansible/site.yaml`: full configuration of all hosts
- `ansible/inventory.ini`: generated inventory
- `ansible/group_vars/all.yaml`: generated from `.env` + outputs
- `ec2-outputs.env`: instance IPs exported from provisioning
- `jenkins/casc.yaml.j2`: JCasC template (injects env like `MONGO_URI` to Jenkins)

## Teardown
Teardown is not automated in the Ansible-only path. Terminate EC2 instances and remove networking resources manually (ask if you want a teardown playbook added).
