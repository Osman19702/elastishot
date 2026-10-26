@browser @cli @git
Feature: H — Checking a pull request without baselines
  As someone reviewing a pull request
  I want the branch compared with its base, both served on the same machine in the same run
  So that I see what the change does to the UI without keeping baselines in the repository

  Background:
    Given a repository with version 1 of a page committed and version 2 in the working tree

  Scenario: H1 — A branch is compared with its base without committed baselines
    When I run pr
    Then the command exits with 1 and names the changed locators
    And no baseline folder was written and no worktree is left

  Scenario: H2 — A page the branch adds is new, not an error
    Given the working tree also adds a page the base does not have
    When I run pr
    Then that page is reported as new, with the reason it is missing on the base

  Scenario: H3 — The job summary gets a table that names the base
    Given GITHUB_STEP_SUMMARY names a file
    When I run pr
    Then the file holds a table headed with the base branch and commit

  Scenario: H4 — A base that captures nothing exits 2 and leaves no worktree behind
    Given no target exists on the base commit
    When I run pr
    Then the command exits with 2 and git lists no extra worktree

  Scenario: H5 — A server command that ignores its port fails instead of comparing another server
    Given pr.serve.command starts a server on a port of its own
    When I run pr
    Then the command exits with 2 and says the command must listen on {port}
