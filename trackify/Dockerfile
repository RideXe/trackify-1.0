# ─────────────────────────────────────────────────────────────
# Stage 0 – Build the React web frontend
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS web-builder
WORKDIR /web

COPY trackify-web/package.json trackify-web/package-lock.json trackify-web/.npmrc ./
RUN npm ci

COPY trackify-web/ .
RUN npm run build

# ─────────────────────────────────────────────────────────────
# Stage 1 – Build the Java backend with Gradle
# ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk AS builder
WORKDIR /build

# Copy wrapper + config first (better layer caching)
COPY trackify/gradlew trackify/settings.gradle trackify/build.gradle ./
COPY trackify/gradle/ gradle/

# Make gradlew executable and pre-fetch dependencies
RUN chmod +x gradlew && ./gradlew dependencies --no-daemon -q || true

# Copy source files and build
COPY trackify/src/ src/
COPY trackify/schema/ schema/
COPY trackify/templates/ templates/
RUN ./gradlew assemble --no-daemon

# ─────────────────────────────────────────────────────────────
# Stage 2 – Build a minimal custom JRE (smaller final image)
# ─────────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk AS jre-builder
RUN jlink \
    --add-modules java.se,jdk.charsets,jdk.crypto.ec,jdk.unsupported,jdk.naming.dns,jdk.naming.rmi \
    --strip-debug --no-header-files --no-man-pages --compress=2 \
    --output /custom-jre

# Trust Amazon RDS certificates so MySQL connections can use sslMode=VERIFY_IDENTITY.
# Only the root CAs are imported — AWS advises against trusting intermediates,
# which break when RDS rotates server certificates.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /tmp/rds/global-bundle.pem
RUN cd /tmp/rds \
    && command -v openssl >/dev/null \
    && awk '/-----BEGIN CERTIFICATE-----/{n++} n>0 {print > ("cert-" n ".pem")}' global-bundle.pem \
    && imported=0 \
    && for cert in cert-*.pem; do \
         subject=$(openssl x509 -in "$cert" -noout -subject -nameopt RFC2253 | sed 's/^subject=//'); \
         issuer=$(openssl x509 -in "$cert" -noout -issuer -nameopt RFC2253 | sed 's/^issuer=//'); \
         if [ "$subject" = "$issuer" ]; then \
           keytool -importcert -noprompt -keystore /custom-jre/lib/security/cacerts -storepass changeit \
             -alias "rds-$(basename "$cert" .pem)" -file "$cert" || exit 1; \
           imported=$((imported + 1)); \
         fi; \
       done \
    && echo "Imported $imported RDS root CA certificate(s)" \
    && [ "$imported" -gt 0 ] \
    && rm -rf /tmp/rds

# ─────────────────────────────────────────────────────────────
# Stage 3 – Lean runtime image
# ─────────────────────────────────────────────────────────────
FROM debian:stable-slim
LABEL org.opencontainers.image.title="Trackify Server"
LABEL org.opencontainers.image.description="Custom Trackify GPS Tracking Server"

# Copy the minimal JRE
COPY --from=jre-builder /custom-jre /opt/trackify/jre

# Copy compiled server JAR and all dependency JARs
COPY --from=builder /build/target/tracker-server.jar /opt/trackify/tracker-server.jar
COPY --from=builder /build/target/lib/ /opt/trackify/lib/

# Copy schema migrations and report templates (needed at runtime)
COPY --from=builder /build/schema/ /opt/trackify/schema/
COPY --from=builder /build/templates/ /opt/trackify/templates/

# Copy the built React frontend — the Java server serves it from /opt/trackify/web/
COPY --from=web-builder /web/build/ /opt/trackify/web/

# Create directories for config, data, logs, and media, owned by a non-root user
RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system trackify \
    && useradd --system --gid trackify --home-dir /opt/trackify --no-create-home trackify \
    && mkdir -p /opt/trackify/conf /opt/trackify/data /opt/trackify/logs /opt/trackify/media \
    && chown -R trackify:trackify /opt/trackify/conf /opt/trackify/data /opt/trackify/logs /opt/trackify/media

# Mount points – config and data should be provided at runtime
VOLUME ["/opt/trackify/conf", "/opt/trackify/data", "/opt/trackify/logs", "/opt/trackify/media"]

WORKDIR /opt/trackify
USER trackify

# 8082 = REST API / Web UI | 5023 = GT06 | 5027 = Teltonika (TCP + UDP) | 5055 = phone app
EXPOSE 8082
EXPOSE 5023/tcp 5027/tcp 5027/udp 5055/tcp

ENTRYPOINT ["/opt/trackify/jre/bin/java"]
CMD ["-jar", "tracker-server.jar", "conf/trackify.xml"]
