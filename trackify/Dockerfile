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

# Create directories for config, data, and logs
RUN apt-get update && apt-get install -y --no-install-recommends wget \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/trackify/conf /opt/trackify/data /opt/trackify/logs

# Mount points – config and data should be provided at runtime
VOLUME ["/opt/trackify/conf", "/opt/trackify/data", "/opt/trackify/logs"]

WORKDIR /opt/trackify

# 8082 = REST API / Web UI   |   5000-5150 = GPS device protocol ports
EXPOSE 8082
EXPOSE 5000-5150

ENTRYPOINT ["/opt/trackify/jre/bin/java"]
CMD ["-jar", "tracker-server.jar", "conf/trackify.xml"]
