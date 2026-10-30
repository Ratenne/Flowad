FROM maven:3.9-eclipse-temurin-17 AS build
WORKDIR /build
COPY backend/pom.xml ./pom.xml
RUN mvn -B dependency:go-offline
COPY backend/src ./src
RUN mvn -B package -DskipTests

FROM eclipse-temurin:17-jre
WORKDIR /app/backend
COPY --from=build /build/target/recommendations-1.0.0.jar /app/backend/app.jar
COPY dist/ /app/dist/
ENV APP_CONTEXT_PATH=/flowad
EXPOSE 10000
ENTRYPOINT ["java","-jar","/app/backend/app.jar"]
