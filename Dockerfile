# base image
FROM node:lts-gallium

LABEL Description="nodejs container with the maxcul2zigbee bridge" Maintainer="kontakt@idbtec.de" Version="1.0"

ENV DEBIAN_FRONTEND=noninteractive

####### set default timezone ######
RUN ln -fs /usr/share/zoneinfo/Europe/Berlin /etc/localtime

####### install #######
RUN mkdir /app
ADD . /app

RUN cd /app && npm install

COPY storage/configuration_sample.yaml /app/storage/configuration.yaml
WORKDIR /app
####### command #######
CMD /usr/local/bin/node index.js