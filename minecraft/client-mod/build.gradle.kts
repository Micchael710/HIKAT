plugins {
    `java-library`
    id("net.neoforged.moddev") version "2.0.72"
}

neoForge {
    version = property("neoforge_version").toString()
}

dependencies {
    // Foundation dependencies for NeoForge Minecraft 1.21.1 client mod
    // Full NeoForge gradle plugin & runtime integration will be activated in the Minecraft auth shard
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
}

tasks.compileTestJava {
    classpath += sourceSets["main"].compileClasspath
}

tasks.test {
    useJUnitPlatform()
    classpath += sourceSets["main"].compileClasspath + sourceSets["main"].runtimeClasspath
}

