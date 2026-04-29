from playwright.sync_api import Page, expect


def test_delete_map_re_entry_guard(gm_page: Page):
    """Double-click the delete-map button during a pending delete
    must not fire a second DELETE request."""
    gm_page.click("[data-tab='builder-v2']")
    expect(gm_page.locator("#bv2-canvas")).to_be_visible()
    gm_page.wait_for_timeout(800)

    # Intercept all network requests to count DELETEs
    delete_count = [0]
    def handle_route(route, request):
        if request.method == "DELETE" and "/maps/" in request.url:
            delete_count[0] += 1
        route.continue_()

    gm_page.route("**/api/builder-v2/maps/**", handle_route)

    # Ensure there is at least one map to delete
    # Click delete button twice rapidly
    btn = gm_page.locator("#bv2-btn-delete-map")
    if btn.is_visible():
        btn.click()
        gm_page.wait_for_timeout(50)
        btn.click()
        # Wait for any pending request to finish
        gm_page.wait_for_timeout(2000)

    assert delete_count[0] <= 1, (
        f"Expected at most 1 DELETE request, got {delete_count[0]}. "
        "Re-entry guard may be missing."
    )
