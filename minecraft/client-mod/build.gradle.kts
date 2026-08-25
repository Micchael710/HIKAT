plugins {
    `java-library`
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

dependencies {
    // Foundation dependencies for NeoForge Minecraft 1.21.1 client mod
    // Full NeoForge gradle plugin & runtime integration will be activated in the Minecraft auth shard
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
}

tasks.test {
    useJUnitPlatform()
}
