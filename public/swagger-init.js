window.addEventListener("DOMContentLoaded", () => {
  SwaggerUIBundle({
    url: "/openapi.json",
    dom_id: "#swagger-ui",
    deepLinking: true,
    displayRequestDuration: true
  });
});
