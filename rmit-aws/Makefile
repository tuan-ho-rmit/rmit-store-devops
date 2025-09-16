SHELL := /bin/bash
CONTROLLER_PY := $(shell if [ -x .venv/bin/python ]; then echo $(PWD)/.venv/bin/python; else which python3; fi)
CHECK_MONGO_SSH ?= 0
SKIP_MONGO ?= 0

STACK_NET := rmit-net
STACK_EC2 := rmit-ec2

.PHONY: up down outputs inventory provision stopall provision-aws preflight aws-wait

up:
	@if [ "$$SKIP_PROVISION" = "1" ]; then \
		echo "[make] SKIP_PROVISION=1 → skipping provisioning (no VPC/EC2 API calls)"; \
	else \
		$(MAKE) provision-aws; \
	fi
	$(MAKE) outputs
	$(MAKE) inventory
	$(MAKE) provision

# Ansible-only provisioning (no CloudFormation)
provision-aws:
	ansible-playbook -i localhost, -c local -e "ansible_python_interpreter=$(CONTROLLER_PY)" ansible/provision-aws.yaml

outputs:
	@echo "Generating ec2-outputs.env from Ansible output..."
	@if [ -f ansible/ec2-outputs.env ]; then \
		cp ansible/ec2-outputs.env ec2-outputs.env; \
		echo "Wrote ec2-outputs.env"; \
	else \
		if [ -f ec2-outputs.env ]; then \
			echo "Using existing ec2-outputs.env"; \
		else \
			echo "ec2-outputs.env not found. If you skipped provisioning, create it manually with instance IPs."; \
		fi; \
	fi

inventory:
	@if [ ! -f ec2-outputs.env ]; then \
		echo "[make] ec2-outputs.env missing. Create it (or run provisioning) then re-run 'make inventory'."; \
		exit 1; \
	fi
	@set -a; . ./ec2-outputs.env; [ -f ./.env ] && . ./.env; set +a; \
	mkdir -p ansible; \
	{ \
	  echo "[jenkins]"; \
	  echo "$${JenkinsIP} ansible_user=ec2-user ansible_ssh_private_key_file=$${EC2_KEY_NAME}.pem"; \
	  echo ""; \
	  echo "[k3s_master]"; \
	  echo "$${MasterIP} ansible_user=ec2-user ansible_ssh_private_key_file=$${EC2_KEY_NAME}.pem"; \
	  echo ""; \
	  echo "[k3s_workers]"; \
	  echo "$${ClientIP} node_label=tier=frontend ansible_user=ec2-user ansible_ssh_private_key_file=$${EC2_KEY_NAME}.pem"; \
	  echo "$${ServerIP} node_label=tier=backend  ansible_user=ec2-user ansible_ssh_private_key_file=$${EC2_KEY_NAME}.pem"; \
	  echo ""; \
	  echo "[mongo]"; \
	  echo "$${MongoIPPub} ansible_user=ec2-user ansible_ssh_private_key_file=$${EC2_KEY_NAME}.pem"; \
	} > ansible/inventory.ini
	@set -a; . ./ec2-outputs.env; [ -f ./.env ] && . ./.env; set +a; \
	jenkins_ip=$$(grep JenkinsIP ec2-outputs.env | cut -d= -f2); \
	mongo_priv=$$(grep MongoPriv ec2-outputs.env | cut -d= -f2); \
	master_priv=$$(grep MasterPriv ec2-outputs.env | cut -d= -f2); \
	base_url="http://$${MasterIP}"; \
	if [ -z "$$JENKINS_URL_HINT" ] || [ "$$JENKINS_URL_HINT" = "http://" ] || echo "$$JENKINS_URL_HINT" | grep -qi localhost; then JENKINS_URL_HINT="http://$${jenkins_ip}:8080/"; fi; \
	mkdir -p ansible/group_vars; \
	printf "dockerhub_user: \"%s\"\n" "$$DOCKERHUB_USER" > ansible/group_vars/all.yaml; \
	printf "dockerhub_pat:  \"%s\"\n" "$$DOCKERHUB_PAT" >> ansible/group_vars/all.yaml; \
	printf "github_owner:   \"%s\"\n" "$$GITHUB_OWNER" >> ansible/group_vars/all.yaml; \
	printf "github_repo:    \"%s\"\n" "$$GITHUB_REPO" >> ansible/group_vars/all.yaml; \
	printf "github_token:   \"%s\"\n" "$$GITHUB_TOKEN" >> ansible/group_vars/all.yaml; \
	printf "jenkins_url_hint: \"%s\"\n" "$$JENKINS_URL_HINT" >> ansible/group_vars/all.yaml; \
	printf "base_url: \"%s\"\n" "$$base_url" >> ansible/group_vars/all.yaml; \
	printf "mongo_uri: \"mongodb://%s:27017/rmit\"\n" "$$mongo_priv" >> ansible/group_vars/all.yaml; \
	printf "master_priv: \"%s\"\n" "$$master_priv" >> ansible/group_vars/all.yaml; \
	printf "jwt_secret: \"prodsecret\"\n" >> ansible/group_vars/all.yaml; \
	printf "ansible_python_interpreter: /usr/bin/python3\n" >> ansible/group_vars/all.yaml; \
	# Jenkins admin (from .env)
	printf "jenkins_admin_user: \"%s\"\n" "$$JENKINS_ADMIN_USER" >> ansible/group_vars/all.yaml; \
	printf "jenkins_admin_password: \"%s\"\n" "$$JENKINS_ADMIN_PASSWORD" >> ansible/group_vars/all.yaml; \
	echo "Created ansible/inventory.ini and group_vars/all.yaml"

aws-wait:
	@if [ "$(SKIP_AWS_WAIT)" = "1" ]; then \
		echo "[aws-wait] SKIP_AWS_WAIT=1 → skipping instance-status-ok wait"; \
		exit 0; \
	fi
	@if [ ! -f ec2-outputs.env ]; then \
		echo "[aws-wait] ec2-outputs.env missing. Create it or run provisioning first."; \
		exit 1; \
	fi
	@set -a; [ -f ./.env ] && . ./.env; set +a; . ./ec2-outputs.env; \
	REGION=$${AWS_REGION:-us-east-1}; \
	echo "[aws-wait] Waiting for EC2 instance status checks (2/2) in $$REGION..."; \
	IDS=$$(aws ec2 describe-instances --region $$REGION --filters "Name=ip-address,Values=$${JenkinsIP},$${MasterIP},$${ClientIP},$${ServerIP},$${MongoIPPub}" --query 'Reservations[].Instances[].InstanceId' --output text); \
	if [ -z "$$IDS" ]; then echo "[aws-wait] Could not resolve instance IDs from IPs in ec2-outputs.env"; exit 1; fi; \
	aws ec2 wait instance-status-ok --region $$REGION --instance-ids $$IDS; \
	echo "[aws-wait] Instances are OK."

preflight:
	@if [ ! -f ec2-outputs.env ]; then \
		echo "[preflight] ec2-outputs.env missing. Create it or run provisioning first."; \
		exit 1; \
	fi
	@set -a; [ -f ./.env ] && . ./.env; set +a; . ./ec2-outputs.env; \
	PEM="./$${EC2_KEY_NAME}.pem"; \
	if [ ! -f "$$PEM" ]; then echo "[preflight] PEM $$PEM not found"; exit 1; fi; \
	HOSTS="$${JenkinsIP} $${MasterIP} $${ClientIP} $${ServerIP}"; \
	if [ "$(CHECK_MONGO_SSH)" = "1" ]; then HOSTS="$$HOSTS $${MongoIPPub}"; fi; \
	for ip in $$HOSTS; do \
	  echo "[preflight] checking ssh $$ip ..."; \
	  ssh -i "$$PEM" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o BatchMode=yes -o ConnectTimeout=10 ec2-user@$$ip "true" || { echo "[preflight] cannot ssh $$ip on port 22. Check your Security Group inbound rules for your IP."; exit 2; }; \
	done; \
	echo "[preflight] SSH reachable to all hosts."
provision: aws-wait preflight
	@LIMIT_OPT=""; if [ "$(SKIP_MONGO)" = "1" ]; then LIMIT_OPT="--limit all:!mongo"; fi; \
	ANSIBLE_HOST_KEY_CHECKING=False ANSIBLE_SSH_COMMON_ARGS='-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ServerAliveInterval=30 -o ConnectTimeout=20' ansible-playbook -i ansible/inventory.ini ansible/site.yaml $$LIMIT_OPT

down:
	@echo "Teardown is not automated in Ansible-only path. Terminate instances and delete VPC manually or I can add a teardown playbook."



stopall:
	@source ec2-outputs.env; ids=$$(aws ec2 describe-instances --filters "Name=ip-address,Values=$${JenkinsIP},$${MasterIP},$${ClientIP},$${ServerIP},$${MongoIPPub}" --query 'Reservations[].Instances[].InstanceId' --output text --region $(AWS_REGION)); \
	aws ec2 stop-instances --instance-ids $$ids --region $(AWS_REGION)
