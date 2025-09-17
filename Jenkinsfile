pipeline {
  agent any
  environment {
    DH_NS     = "${env.DH_NS ?: '<your-dockerhub-username-or-org>'}"
    FRONT_IMG = "docker.io/${DH_NS}/rmit-store-frontend"
    BACK_IMG  = "docker.io/${DH_NS}/rmit-store-backend"
    STAGING_HOST = "${env.STAGING_HOST ?: ''}"
    PROD_HOST    = "${env.PROD_HOST ?: ''}"
    // Speed up Docker builds if available
    DOCKER_BUILDKIT = '1'
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
              node:20-bullseye bash -lc "if [ -f package-lock.json ]; then npm ci; else npm install; fi && npm test -- --coverage --ci"
          '''
        }
        // Archive coverage if present
        script { if (fileExists('server/coverage')) { archiveArtifacts artifacts: 'server/coverage/**', allowEmptyArchive: true } }
      }
    }

    stage('Build images'){
      steps {
        sh """
          docker build --pull --no-cache -t ${BACK_IMG}:${GIT_COMMIT}  ./server
          # Build frontend with API_URL pointing to same-origin /api
          docker build --pull --no-cache --build-arg API_URL=/api -t ${FRONT_IMG}:${GIT_COMMIT} ./client
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
              rancher/kubectl:v1.30.6 get ns staging || \
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              rancher/kubectl:v1.30.6 create ns staging

            # Determine active color (green on first install so Service has endpoints)
            ACTIVE_COLOR=blue
            if ! docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
                 rancher/kubectl:v1.30.6 -n staging get svc backend >/dev/null 2>&1; then
              ACTIVE_COLOR=green
            fi

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
                --set backend.activeColor=${ACTIVE_COLOR} --set frontend.activeColor=${ACTIVE_COLOR} \
                -f values-staging.yaml ${MONGO_FLAG} ${HOST_FLAG}

            # rollout status
            set +e
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              rancher/kubectl:v1.30.6 -n staging rollout status deploy/backend-green --timeout=300s
            BACK_ROLLOUT=$?
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              rancher/kubectl:v1.30.6 -n staging rollout status deploy/frontend-green --timeout=300s
            FRONT_ROLLOUT=$?
            if [ $BACK_ROLLOUT -ne 0 ] || [ $FRONT_ROLLOUT -ne 0 ]; then
              echo "Staging rollout failed; rolling back…"
              docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
                alpine/helm:3.14.4 rollback rmit-store-staging 1 -n staging || true
              exit 1
            fi
            set -e

            # Cutover staging services to green after successful rollout
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              rancher/kubectl:v1.30.6 -n staging patch service backend  -p '{"spec":{"selector":{"app":"backend","activeColor":"green"}}}'
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              rancher/kubectl:v1.30.6 -n staging patch service frontend -p '{"spec":{"selector":{"app":"frontend","activeColor":"green"}}}'

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

    stage('E2E STAGING (Playwright)'){
      steps {
        withCredentials([
          string(credentialsId: 'admin-email', variable: 'P_ADMIN_EMAIL'),
          string(credentialsId: 'admin-pass',  variable: 'P_ADMIN_PASS')
        ]){
          sh '''
            set -e
            # Run Playwright tests against staging in a container
            docker run --rm \
              -e BASE_URL="http://$STAGING_HOST" \
              -e ADMIN_EMAIL="${P_ADMIN_EMAIL:-admin@rmit.edu.vn}" \
              -e ADMIN_PASS="${P_ADMIN_PASS:-ChangeMe123!}" \
              -e READ_ONLY_GUARD=0 \
              -v "$PWD"/tests/e2e-playwright:/e2e -w /e2e \
              mcr.microsoft.com/playwright:v1.48.2-jammy bash -lc "\
                if [ -f package-lock.json ]; then npm ci; else npm install; fi && \
                npx playwright install --with-deps && \
                npx playwright test --reporter=dot"
          '''
        }
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
              rancher/kubectl:v1.30.6 get ns prod || \
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              rancher/kubectl:v1.30.6 create ns prod

            # Determine active color (green on first install so Service has endpoints)
            ACTIVE_COLOR=blue
            if ! docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
                 rancher/kubectl:v1.30.6 -n prod get svc backend >/dev/null 2>&1; then
              ACTIVE_COLOR=green
            fi

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
                --set backend.activeColor=${ACTIVE_COLOR} --set frontend.activeColor=${ACTIVE_COLOR} \
                -f values-prod.yaml ${MONGO_FLAG} ${HOST_FLAG}

            # rollout status
            set +e
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              rancher/kubectl:v1.30.6 -n prod rollout status deploy/backend-green --timeout=300s
            BACK_ROLLOUT=$?
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              rancher/kubectl:v1.30.6 -n prod rollout status deploy/frontend-green --timeout=300s
            FRONT_ROLLOUT=$?
            if [ $BACK_ROLLOUT -ne 0 ] || [ $FRONT_ROLLOUT -ne 0 ]; then
              echo "Prod rollout failed; rolling back…"
              docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
                alpine/helm:3.14.4 rollback rmit-store 1 -n prod || true
              exit 1
            fi
            set -e

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
              rancher/kubectl:v1.30.6 -n prod patch service backend  -p '{"spec":{"selector":{"app":"backend","activeColor":"green"}}}'
            docker run --rm -u 0 -e KUBECONFIG=/kubeconfig -v "$PWD"/kubeconfig:/kubeconfig:ro \
              rancher/kubectl:v1.30.6 -n prod patch service frontend -p '{"spec":{"selector":{"app":"frontend","activeColor":"green"}}}'
            shred -u kubeconfig || rm -f kubeconfig
          '''
        }
      }
    }
  }

  post {
    success {
      echo "Deployment succeeded: ${GIT_COMMIT}"
      mail to: "${env.EMAIL_TO ?: ''}",
           subject: "Deployment Succeeded: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
           body: "Build URL: ${env.BUILD_URL}\nCommit: ${env.GIT_COMMIT}\nStaging: http://${env.STAGING_HOST}\nProd: http://${env.PROD_HOST}"
      script {
        def stF = (env.STAGING_HOST?.trim()) ? "http://${env.STAGING_HOST}/" : null
        def stB = (env.STAGING_HOST?.trim()) ? "http://${env.STAGING_HOST}/api/health" : null
        def prF = (env.PROD_HOST?.trim())    ? "http://${env.PROD_HOST}/" : null
        def prB = (env.PROD_HOST?.trim())    ? "http://${env.PROD_HOST}/api/health" : null
        def links = []
        if (stF) links << "<li><a href='${stF}'>Staging Frontend</a></li>"
        if (stB) links << "<li><a href='${stB}'>Staging Backend (health)</a></li>"
        if (prF) links << "<li><a href='${prF}'>Prod Frontend</a></li>"
        if (prB) links << "<li><a href='${prB}'>Prod Backend (health)</a></li>"
        def html = """
          <h3>Deployed Links</h3>
          <ul>
            ${links.join(' ')}
          </ul>
        """
        currentBuild.description = 'Links: staging/prod'
        try { createSummary(icon: 'link-48x48.png', text: html) } catch (e) { echo "createSummary not available: ${e}" }
      }
    }
    failure {
      echo "Deployment failed at stage: ${env.STAGE_NAME}"
      // Send email via Jenkins core mailer (requires SMTP configured in Manage Jenkins)
      mail to: "${env.EMAIL_TO ?: ''}",
           subject: "Deployment Failed: ${env.JOB_NAME} #${env.BUILD_NUMBER}",
           body: "Build URL: ${env.BUILD_URL}\nStage: ${env.STAGE_NAME}"
    }
  }
}


