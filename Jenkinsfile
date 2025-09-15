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

    stage('Server: Unit/API tests'){
      steps {
        dir('server'){
          sh 'npm ci'
          sh 'npm test'
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

    stage('Deploy GREEN (prod)'){
      steps {
        withCredentials([file(credentialsId: 'kubeconfig-master', variable: 'KUBECONF')]){
          sh """
            export KUBECONFIG=$KUBECONF
            helm upgrade --install rmit-store ./helm/rmit-store -n prod \
              --set backend.greenImage=${BACK_IMG}:${GIT_COMMIT} \
              --set frontend.greenImage=${FRONT_IMG}:${GIT_COMMIT} \
              --set backend.activeColor=blue --set frontend.activeColor=blue \
              -f ./helm/rmit-store/values-prod.yaml

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


