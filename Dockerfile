# base image
FROM node:12.18.0-stretch

LABEL Description="nodejs container with the maxcul2zigbee bridge" Maintainer="kontakt@idbtec.de" Version="1.0"

ENV DEBIAN_FRONTEND=noninteractive

####### set default timezone ######
RUN ln -fs /usr/share/zoneinfo/Europe/Berlin /etc/localtime

####### install #######
RUN mkdir /app
RUN cd /app && npm install https://gitlab.com/fbeek/maxcul2mqtt.git

COPY configuration_sample.yaml /app/configuration.yaml

####### command #######
CMD /usr/local/bin/node /app/index.js