extra.apply {
    set("compileSdkVersion", 36)
    set("targetSdkVersion", 34)
    set("minSdkVersion", 21)
}

allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory = rootProject.layout.buildDirectory.dir("../../build").get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    project.layout.buildDirectory.value(newBuildDir.dir(project.name))
}

subprojects {
    afterEvaluate {
        val androidExt = extensions.findByName("android") ?: return@afterEvaluate
        try {
            androidExt.javaClass
                .getMethod("setCompileSdkVersion", Int::class.javaPrimitiveType)
                .invoke(androidExt, 36)
        } catch (_: Exception) {}
        if (project.name == "camera_android_camerax") {
            project.dependencies.add("implementation", "androidx.concurrent:concurrent-futures:1.2.0")
        }
    }
}

subprojects {
    if (name != "app") {
        evaluationDependsOn(":app")
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
