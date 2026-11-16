plugins {
    java
    id("com.gradleup.shadow") version "9.2.2"
}

group = "kr.mcpanel"
version = "1.0.0"

repositories {
    mavenCentral()
    maven("https://repo.papermc.io/repository/maven-public/")
}

dependencies {
    compileOnly("io.papermc.paper:paper-api:26.3.build.253-stable")
    // Paper 서버에 이미 들어 있는 log4j (콘솔 로그를 가로채는 데 사용)
    compileOnly("org.apache.logging.log4j:log4j-core:2.24.1")
    // 플러그인 안에서 돌아가는 WebSocket 서버
    implementation("org.java-websocket:Java-WebSocket:1.5.7")
}

// 마인크래프트 26.x 서버는 Java 25 가 필요하므로 Java 25 용으로 컴파일한다 (JDK 25 이상 필요)
tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
    options.release.set(25)
}

tasks.processResources {
    filesMatching("plugin.yml") {
        expand("version" to project.version)
    }
}

tasks.shadowJar {
    archiveClassifier.set("")
    relocate("org.java_websocket", "kr.mcpanel.libs.websocket")
    // slf4j 는 Paper 에 이미 있으므로 포함하지 않는다
    dependencies {
        exclude(dependency("org.slf4j:.*"))
    }
}

tasks.build {
    dependsOn(tasks.shadowJar)
}

tasks.jar {
    enabled = false
}
