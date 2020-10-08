#!/bin/bash
echo
echo $DOCKER_PASSWORD | docker login -u fbeek --password-stdin &> /dev/null

TAG="${TRAVIS_TAG:-latest}"
docker buildx build \
     --progress plain \
    --platform=linux/amd64,linux/arm/v7 \
    -t $DOCKER_REPO:$TAG \
    --push \
    .