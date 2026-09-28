package com.retroweb.api.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.nio.file.Path;
import java.nio.file.Paths;

/**
 * 由 Spring Boot 同源托管前端，避免浏览器 CORS 导致 RA 登录 Failed to fetch。
 * 静态资源来自仓库根目录（index.html / emu / vendor / storage / achievements）。
 */
@Configuration
public class StaticWebConfig implements WebMvcConfigurer {

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // api/ 的工作目录通常是 api/，前端在上级仓库根
        String root = Paths.get("..").toAbsolutePath().normalize().toString().replace('\\', '/');
        String apiDir = Paths.get(".").toAbsolutePath().normalize().toString().replace('\\', '/');

        String[] locations = new String[] {
                "file:" + root + "/",
                "file:" + apiDir + "/public/",
                "classpath:/static/"
        };

        registry.addResourceHandler("/**").addResourceLocations(locations);
    }
}
