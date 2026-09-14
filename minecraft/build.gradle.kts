plugins {
    id("java")
    id("net.neoforged.moddev") version "2.0.147"
}

version = property("mod_version") as String
group = "com.hikat"

base {
    archivesName.set("hikat")
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(21))
    }
}

neoForge {
    version = property("neoforge_version") as String

    mods {
        create("hikat") {
            sourceSet(sourceSets.main.get())
        }
    }

    runs {
        configureEach {
            systemProperty("neoforge.logging.markers", "REGISTRIES")
            systemProperty("neoforge.logging.console.level", "debug")
        }
        create("client") {
            client()
        }
        create("server") {
            server()
            programArgument("--nogui")
        }
    }
}

repositories {
    mavenCentral()
}

dependencies {
    jarJar("com.nimbusds:nimbus-jose-jwt:9.40")
    implementation("com.nimbusds:nimbus-jose-jwt:9.40")

    testImplementation(platform("org.junit:junit-bom:5.10.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.withType<Test> {
    useJUnitPlatform()
    classpath = sourceSets.test.get().runtimeClasspath + sourceSets.main.get().compileClasspath
}

tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}
