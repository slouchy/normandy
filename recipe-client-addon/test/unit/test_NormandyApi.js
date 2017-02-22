"use strict";
// Cu is defined in xpc_head.js
/* globals Cu */

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/Task.jsm");
Cu.import("resource://testing-common/httpd.js"); /* globals HttpServer */
Cu.import("resource://gre/modules/osfile.jsm", this); /* globals OS, TextDecoder */
Cu.import("resource://shield-recipe-client/lib/NormandyApi.jsm", this);

function withServer(task) {
  return function* inner() {
    const server = makeMockApiServer();
    const serverUrl = `http://localhost:${server.identity.primaryPort}`;
    Services.prefs.setCharPref("extensions.shield-recipe-client.api_url", `${serverUrl}/api/v1`);
    Services.prefs.setCharPref(
      "security.content.signature.root_hash",
      // Hash of the key that signs the normandy dev certificates
      "4C:35:B1:C3:E3:12:D9:55:E7:78:ED:D0:A7:E7:8A:38:83:04:EF:01:BF:FA:03:29:B2:46:9F:3C:C5:EC:36:04"
    );
    yield task(serverUrl);
    yield new Promise(resolve => server.stop(resolve));
  };
}

function makeMockApiServer() {
  const server = new HttpServer();
  server.registerDirectory("/", do_get_file("mock_api"));

  server.setIndexHandler(Task.async(function* (request, response) {
    response.processAsync();
    const dir = request.getProperty("directory");
    const index = dir.clone();
    index.append("index.json");

    if (!index.exists()) {
      response.setStatusLine("1.1", 404, "Not Found");
      response.write(`Cannot find path ${index.path}`);
      response.finish();
      return;
    }

    try {
      const contentsArray = yield OS.File.read(index.path);
      const contents = new TextDecoder().decode(contentsArray);
      response.write(contents);
    } catch(e) {
      response.setStatusLine("1.1", 500, "Server error");
      response.write(e.toString());
    } finally {
      response.finish();
    }
  }));

  server.start(-1);
  return server;
}

add_task(withServer(function* test_get(serverUrl) {
  // Test that NormandyApi can fetch from the test server.
  const response = yield NormandyApi.get(`${serverUrl}/api/v1`);
  const data = yield response.json();
  equal(data["recipe-list"], "/api/v1/recipe/", "Expected data in response");
}));

add_task(withServer(function* test_getApiUrl(serverUrl) {
  const apiBase = `${serverUrl}/api/v1`;
  // Test that NormandyApi can use the self-describing API's index
  const recipeListUrl = yield NormandyApi.getApiUrl("action-list");
  equal(recipeListUrl, `${apiBase}/action/`, "Can retrieve action-list URL from API");
}));

add_task(withServer(function* test_fetchRecipes() {
  const recipes = yield NormandyApi.fetchRecipes();
  equal(recipes.length, 1);
  equal(recipes[0].name, "system-addon-test");
}));

add_task(withServer(function* test_classifyClient() {
  const classification = yield NormandyApi.classifyClient();
  Assert.deepEqual(classification, {
    country: "US",
    request_time: new Date("2017-02-22T17:43:24.657841Z"),
  });
}));

add_task(withServer(function* test_fetchAction() {
  const action = yield NormandyApi.fetchAction("show-heartbeat");
  equal(action.name, "show-heartbeat");
}));
