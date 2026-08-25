plugins {
    base
}

allprojects {
    group = "com.hikat.minecraft"
    version = "0.1.0"

    repositories {
        mavenCentral()
        maven {
            name = "NeoForged"
            url = uri("https://maven.neoforged.net/releases")
        }
        maven {
            name = "PaperMC"
            url = uri("https://repo.papermc.io/repository/maven-public/")
        }
    }
}
