pipeline {
  agent any
  environment {
    DH_NS     = "${env.DH_NS ?: '<your-dockerhub-username-or-org>'}"
    FRONT_IMG = "docker.io/${DH_NS}/rmit-store-frontend"
    BACK_IMG  = "docker.io/${DH_NS}/rmit-store-backend"
    STAGING_HOST = "${env.STAGING_HOST ?: ''}"
    PROD_HOST    = "${env.PROD_HOST ?: ''}"
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
          sh '''
            echo "$DH_TOKEN" | docker login -u "$DH_USER" --password-stdin
            docker push ${BACK_IMG}:${GIT_COMMIT}
            docker push ${FRONT_IMG}:${GIT_COMMIT}
          '''
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
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 get ns staging || \
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 create ns staging

            # helm upgrade/install (mount repo root)
            MONGO_FLAG=""; [ -n "${MONGO_URI}" ] && MONGO_FLAG="--set-string mongo.uri=${MONGO_URI}";
            if [ -z "$STAGING_HOST" ]; then
              echo "STAGING_HOST is not set. Provide via JCasC env or .env → Makefile inventory."
              exit 1
            fi
            HOST_FLAG="--set host=${STAGING_HOST}"
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig \
              -v "$PWD"/kubeconfig:/kubeconfig:ro \
              -v "$PWD":/work -w /work/helm/rmit-store \
              alpine/helm:3.14.4 upgrade --install rmit-store-staging . -n staging \
                --set backend.greenImage=${BACK_IMG}:${GIT_COMMIT} \
                --set frontend.greenImage=${FRONT_IMG}:${GIT_COMMIT} \
                --set backend.activeColor=blue --set frontend.activeColor=blue \
                -f values-staging.yaml ${MONGO_FLAG} ${HOST_FLAG}

            # rollout status
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n staging rollout status deploy/backend-green --timeout=300s || true
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n staging rollout status deploy/frontend-green --timeout=300s || true

            # Diagnostics (always print for visibility)
            echo '--- staging: deploy/rs/pods';
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n staging get deploy,rs,pods -o wide || true
            echo '--- staging: describe backend-green';
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n staging describe deploy backend-green | tail -n +1 || true
            echo '--- staging: backend logs (last 200)';
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n staging logs -l app=backend,activeColor=green --tail=200 || true

            shred -u kubeconfig || rm -f kubeconfig
          '''
        }
      }
    }

    stage('Smoke STAGING'){
      steps {
        sh '''
          if [ -z "$STAGING_HOST" ]; then
            echo "STAGING_HOST is not set. Provide via JCasC env or .env → Makefile inventory."
            exit 1
          fi
          STAGING_URL="http://$STAGING_HOST/api/health"
          echo "Staging smoke URL: $STAGING_URL"
          docker run --rm curlimages/curl:8.8.0 -fsS "$STAGING_URL"
        '''
      }
    }

    stage('Deploy GREEN (prod)'){
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-master', variable: 'KUBECONF')]){
          sh '''
            set -e
            cp "$KUBECONF" kubeconfig && chmod 600 kubeconfig

            # kubectl create ns if missing
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 get ns prod || \
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 create ns prod

            # helm upgrade/install (mount repo root)
            MONGO_FLAG=""; [ -n "${MONGO_URI}" ] && MONGO_FLAG="--set-string mongo.uri=${MONGO_URI}";
            if [ -z "$PROD_HOST" ]; then
              echo "PROD_HOST is not set. Provide via JCasC env or .env → Makefile inventory."
              exit 1
            fi
            HOST_FLAG="--set host=${PROD_HOST}"
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig \
              -v "$PWD"/kubeconfig:/kubeconfig:ro \
              -v "$PWD":/work -w /work/helm/rmit-store \
              alpine/helm:3.14.4 upgrade --install rmit-store . -n prod \
                --set backend.greenImage=${BACK_IMG}:${GIT_COMMIT} \
                --set frontend.greenImage=${FRONT_IMG}:${GIT_COMMIT} \
                --set backend.activeColor=blue --set frontend.activeColor=blue \
                -f values-prod.yaml ${MONGO_FLAG} ${HOST_FLAG}

            # rollout status
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n prod rollout status deploy/backend-green --timeout=300s
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n prod rollout status deploy/frontend-green --timeout=300s

            shred -u kubeconfig || rm -f kubeconfig
          '''
        }
      }
    }

    stage('Smoke GREEN'){
      steps {
        sh '''
          if [ -z "$PROD_HOST" ]; then
            echo "PROD_HOST is not set. Provide via JCasC env or .env → Makefile inventory."
            exit 1
          fi
          PROD_URL="http://$PROD_HOST/api/health"
          echo "Prod smoke URL: $PROD_URL"
          docker run --rm curlimages/curl:8.8.0 -fsS "$PROD_URL"
        '''
      }
    }

    stage('Cutover BLUE -> GREEN'){
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-master', variable: 'KUBECONF')]){
          sh '''
            set -e
            cp "$KUBECONF" kubeconfig && chmod 600 kubeconfig
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              bitnami/kubectl:1.30 -n prod patch service backend  -p '{"spec":{"selector":{"app":"backend","activeColor":"green"}}}'
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
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


