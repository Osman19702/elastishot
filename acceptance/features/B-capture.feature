@browser
Feature: B — Capturing a page with its element map
  As someone tracking a page across deployments
  I want each capture to record where every visible element is and how to locate it
  So that differences can be named, not just drawn

  Background:
    Given a page is served locally

  Scenario: B1 — Elements get the most stable locator available
    When I snapshot the page
    Then an element with a data-testid is located by that test id
    And an element with a hand-written id is located by its id
    And a heading with a unique text is located by role and name
    And repeated elements fall back to a CSS path anchored at the nearest id

  Scenario: B2 — Hidden selectors are left out of the map
    When I snapshot the page hiding the FAQ
    Then the FAQ is absent from the element map

  Scenario: B3 — Element boxes follow the device pixel ratio
    When I snapshot the page at a device pixel ratio of 2
    Then the image is twice as wide as the viewport
    And the button box is twice its CSS size
