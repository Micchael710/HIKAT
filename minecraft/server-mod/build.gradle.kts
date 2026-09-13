plugins {
    `java-library`
    id("net.neoforged.moddev") version "2.0.72"
}

neoForge {
    version = property("neoforge_version").toString()
    mods {
        create("hikat_server") {
            sourceSet(sourceSets["main"])
        }
    }
    runs {
        create("server") {
            server()
            programArgument("--nogui")
        }
    }
}

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:5.10.2")
}

tasks.compileTestJava {
    classpath += sourceSets["main"].compileClasspath
}

tasks.test {
    useJUnitPlatform()
    classpath += sourceSets["main"].compileClasspath + sourceSets["main"].runtimeClasspath
}

