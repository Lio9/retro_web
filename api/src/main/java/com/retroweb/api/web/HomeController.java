package com.retroweb.api.web;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

/**
 * 根路径转发到前端首页（同源托管）
 */
@Controller
public class HomeController {

    @GetMapping({"/"})
    public String index() {
        return "forward:/index.html";
    }
}
