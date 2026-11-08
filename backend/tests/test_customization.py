def test_shelf_style_and_reader_environment_are_private_independent_preferences(client, other):
    response = client.patch(
        "/api/v1/settings", {"shelf_style": "wood", "reader_texture": "paper", "texture": "linen"}, format="json"
    )
    assert response.status_code == 200, response.data
    assert response.data["texture"] == "linen"
    assert response.data["reader_texture"] == "paper"
    assert other.get("/api/v1/settings").data["reader_texture"] == "none"
    invalid = client.patch("/api/v1/settings", {"shelf_style": "url(https://outside.example)"}, format="json")
    assert invalid.status_code == 400
