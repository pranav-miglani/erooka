# Authentication Feature

Feature: User Authentication
  As a user
  I want to log in to the system
  So that I can access my account

  Background:
    Given the system has the following accounts:
      | email              | password | accountType | orgId | isActive |
      | admin@erooka.com   | admin123 | SUPERADMIN  | null  | true     |
      | org1@erooka.com    | org123   | ORG         | 1     | true     |
      | govt@erooka.com    | govt123  | GOVT        | null  | true     |

  Scenario: Successful login with valid credentials
    When I login with email "admin@erooka.com" and password "admin123"
    Then I should receive a 200 status code
    And the response should contain account information
    And a session cookie should be set
    And the session should contain accountId, accountType, and email

  Scenario: Login fails with invalid email
    When I login with email "nonexistent@erooka.com" and password "password123"
    Then I should receive a 401 status code
    And the error message should be "Invalid credentials"

  Scenario: Login fails with invalid password
    When I login with email "admin@erooka.com" and password "wrongpassword"
    Then I should receive a 401 status code
    And the error message should be "Invalid credentials"

  Scenario: Login fails with missing email
    When I login with email "" and password "password123"
    Then I should receive a 400 status code
    And the error message should be "Email and password are required"

  Scenario: Login fails with missing password
    When I login with email "admin@erooka.com" and password ""
    Then I should receive a 400 status code
    And the error message should be "Email and password are required"

  Scenario: Login fails with inactive account
    Given the account "inactive@erooka.com" exists with isActive "false"
    When I login with email "inactive@erooka.com" and password "password123"
    Then I should receive a 401 status code
    And the error message should be "Account is inactive"

