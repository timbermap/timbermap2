FROM docker.osgeo.org/geoserver:2.25.x

ENV GEOSERVER_DATA_DIR=/opt/geoserver/data_dir
ENV GEOWEBCACHE_CACHE_DIR=/opt/geoserver/gwc
ENV JAVA_OPTS="-Xms256m -Xmx1g"

# Install GCS Community Plugin so GeoServer can read gs:// URLs natively
RUN curl -sL "https://build.geoserver.org/geoserver/main/community-latest/geoserver-main-community-gcs-plugin.zip" \
    -o /tmp/gcs-plugin.zip && \
    unzip -o /tmp/gcs-plugin.zip -d /opt/geoserver/webapps/geoserver/WEB-INF/lib/ && \
    rm /tmp/gcs-plugin.zip

EXPOSE 8080
