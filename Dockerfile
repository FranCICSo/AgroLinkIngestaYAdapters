FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /build
COPY pom.xml .
RUN mvn -B dependency:go-offline
COPY src ./src
RUN mvn -B package -DskipTests

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app

RUN addgroup -S agrolink && adduser -S agrolink -G agrolink
COPY --from=build /build/target/*.jar app.jar
USER agrolink

ENTRYPOINT ["java", "-jar", "/app/app.jar"]
