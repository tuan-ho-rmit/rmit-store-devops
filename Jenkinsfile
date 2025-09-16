pipeline {
  agent any
  environment {
    DH_NS     = "${env.DH_NS ?: '<your-dockerhub-username-or-org>'}"
    FRONT_IMG = "docker.io/${DH_NS}/rmit-store-frontend"
    BACK_IMG  = "docker.io/${DH_NS}/rmit-store-backend"
    BASE_URL  = "${env.BASE_URL ?: 'http://<MASTER_PUBLIC_IP>'}"
  }
  triggers { githubPush() }

  stages {
    stage('Checkout'){ steps { checkout scm } }

    stage('Server: Unit/API tests'){
      steps {
        dir('server'){
          sh '''
            docker run --rm \
              -v $PWD:/app -w /app \
              node:18-alpine sh -lc "npm ci && npm test"
          '''
        }
      }
    }

    stage('Build images'){
      steps {
        sh """
          docker build -t ${BACK_IMG}:${GIT_COMMIT}  ./server
          docker build -t ${FRONT_IMG}:${GIT_COMMIT} ./client
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

    stage('Deploy STAGING'){
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-master', variable: 'KUBECONF')]){
          sh '''
            set -e
            cp "$KUBECONF" kubeconfig && chmod 600 kubeconfig

            # kubectl create ns if missing
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 get ns staging || \
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 create ns staging

            # helm upgrade/install
            docker run --rm -e KUBECONFIG=/kubeconfig \
              -v "$PWD"/kubeconfig:/kubeconfig:ro \
              -v "$PWD"/helm:/helm -w /helm/rmit-store \
              alpine/helm:3.14.4 upgrade --install rmit-store-staging . -n staging \
                --set backend.greenImage=${BACK_IMG}:${GIT_COMMIT} \
                --set frontend.greenImage=${FRONT_IMG}:${GIT_COMMIT} \
                --set backend.activeColor=blue --set frontend.activeColor=blue \
                -f /helm/rmit-store/values-staging.yaml

            # rollout status
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n staging rollout status deploy/backend-green --timeout=120s || true
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n staging rollout status deploy/frontend-green --timeout=120s || true

            shred -u kubeconfig || rm -f kubeconfig
          '''
        }
      }
    }

    stage('Smoke STAGING'){
      steps {
        sh """
          docker run --rm curlimages/curl:8.8.0 -fsS ${BASE_URL}/staging/api/health
        """
      }
    }

    stage('Deploy GREEN (prod)'){
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-master', variable: 'KUBECONF')]){
          sh '''
            set -e
            cp "$KUBECONF" kubeconfig && chmod 600 kubeconfig

            # kubectl create ns if missing
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 get ns prod || \
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 create ns prod

            # helm upgrade/install
            docker run --rm -e KUBECONFIG=/kubeconfig \
              -v "$PWD"/kubeconfig:/kubeconfig:ro \
              -v "$PWD"/helm:/helm -w /helm/rmit-store \
              alpine/helm:3.14.4 upgrade --install rmit-store . -n prod \
                --set backend.greenImage=${BACK_IMG}:${GIT_COMMIT} \
                --set frontend.greenImage=${FRONT_IMG}:${GIT_COMMIT} \
                --set backend.activeColor=blue --set frontend.activeColor=blue \
                -f /helm/rmit-store/values-prod.yaml

            # rollout status
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n prod rollout status deploy/backend-green --timeout=120s
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n prod rollout status deploy/frontend-green --timeout=120s

            shred -u kubeconfig || rm -f kubeconfig
          '''
        }
      }
    }

    stage('Smoke GREEN'){
      steps {
        sh """
          docker run --rm curlimages/curl:8.8.0 -fsS ${BASE_URL}/api/health
        """
      }
    }

    stage('Cutover BLUE -> GREEN'){
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-master', variable: 'KUBECONF')]){
          sh '''
            set -e
            cp "$KUBECONF" kubeconfig && chmod 600 kubeconfig
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n prod patch service backend  -p '{"spec":{"selector":{"app":"backend","activeColor":"green"}}}'
            docker run --rm -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n prod patch service frontend -p '{"spec":{"selector":{"app":"frontend","activeColor":"green"}}}'
            shred -u kubeconfig || rm -f kubeconfig
          '''
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


