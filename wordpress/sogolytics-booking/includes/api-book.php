<?php
/**
 * REST handler: POST /wp-json/sgbk/v1/book
 *
 * Pure PHP replacement for api/book.js — no Vercel needed.
 * Creates the Outlook calendar event via Graph API and a Salesforce
 * lead via REST. SF failure is non-blocking.
 */

if ( ! defined( 'ABSPATH' ) ) exit;

/* ── Salesforce lead (non-blocking — failure never surfaces to user) ── */

function sgbk_create_sf_lead( $opts, $lead ) {
    $login_url = $opts['sf_login_url'] ?? 'https://login.salesforce.com';

    $auth_res = wp_remote_post( $login_url . '/services/oauth2/token', [
        'timeout' => 10,
        'body'    => [
            'grant_type'    => 'password',
            'client_id'     => $opts['sf_client_id']     ?? '',
            'client_secret' => $opts['sf_client_secret'] ?? '',
            'username'      => $opts['sf_username']       ?? '',
            'password'      => ( $opts['sf_password'] ?? '' ) . ( $opts['sf_security_token'] ?? '' ),
        ],
    ] );

    if ( is_wp_error( $auth_res ) ) {
        error_log( '[sgbk book] SF auth wp_error: ' . $auth_res->get_error_message() );
        return;
    }
    $auth_code = wp_remote_retrieve_response_code( $auth_res );
    if ( $auth_code !== 200 ) {
        error_log( '[sgbk book] SF auth HTTP ' . $auth_code . ': ' . wp_remote_retrieve_body( $auth_res ) );
        return;
    }

    $auth_data    = json_decode( wp_remote_retrieve_body( $auth_res ), true );
    $access_token = $auth_data['access_token'] ?? '';
    $instance_url = $auth_data['instance_url'] ?? '';
    if ( ! $access_token || ! $instance_url ) {
        error_log( '[sgbk book] SF auth missing token/instance_url' );
        return;
    }

    $lead_res = wp_remote_post( $instance_url . '/services/data/v58.0/sobjects/Lead/', [
        'timeout' => 10,
        'headers' => [
            'Authorization' => 'Bearer ' . $access_token,
            'Content-Type'  => 'application/json',
        ],
        'body' => wp_json_encode( [
            'FirstName'       => $lead['firstName'],
            'LastName'        => $lead['lastName'],
            'Email'           => $lead['email'],
            'Phone'           => $lead['phone'] ?? '',
            'Company'         => 'Unknown',
            'LeadSource'      => 'Web Demo Booking',
            'Project_Type__c' => $lead['projectType'],
            'Country'         => $lead['country'] ?? '',
        ] ),
    ] );

    if ( is_wp_error( $lead_res ) ) {
        error_log( '[sgbk book] SF lead wp_error: ' . $lead_res->get_error_message() );
        return;
    }
    $lead_code = wp_remote_retrieve_response_code( $lead_res );
    if ( $lead_code !== 201 ) {
        error_log( '[sgbk book] SF lead HTTP ' . $lead_code . ': ' . wp_remote_retrieve_body( $lead_res ) );
    }
}

/* ── Main REST handler ── */

function sgbk_book_handler( WP_REST_Request $req ) {
    $body = $req->get_json_params();

    $region      = sanitize_text_field( $body['region']      ?? 'row' );
    $slot        = sanitize_text_field( $body['slot']        ?? '' );
    $first_name  = sanitize_text_field( $body['firstName']   ?? '' );
    $last_name   = sanitize_text_field( $body['lastName']    ?? '' );
    $email       = sanitize_email(      $body['email']       ?? '' );
    $phone       = sanitize_text_field( $body['phone']       ?? '' );
    $project     = sanitize_text_field( $body['projectType'] ?? '' );
    $timezone    = sanitize_text_field( $body['timezone']    ?? 'UTC' );
    $country     = sanitize_text_field( $body['country']     ?? '' );

    if ( ! $slot || ! $first_name || ! $last_name || ! $email || ! $project ) {
        return new WP_Error( 'missing_fields', 'Required fields missing', [ 'status' => 400 ] );
    }

    $opts = get_option( 'sgbk_settings', [] );

    $tenant_id     = $opts['azure_tenant_id']     ?? '';
    $client_id     = $opts['azure_client_id']     ?? '';
    $client_secret = $opts['azure_client_secret'] ?? '';

    /* ── Demo mode ── */
    if ( empty( $tenant_id ) || empty( $client_id ) || empty( $client_secret ) ) {
        error_log( '[sgbk book] demo mode — simulating booking for ' . $email );
        // Small delay to simulate network call in demo mode
        usleep( 500000 );
        return rest_ensure_response( [
            'success'    => true,
            'meetingLink'=> null,
            'eventId'    => 'demo-' . time(),
            'bookedSlot' => $slot,
            'demo'       => true,
        ] );
    }

    /* ── Live mode ── */
    $cal_email = ( $region === 'us' )
        ? ( $opts['cal_us']  ?? 'us-demos@sogolytics.com' )
        : ( $opts['cal_row'] ?? 'row-demos@sogolytics.com' );

    // Get Graph token (sgbk_get_graph_token defined in api-availability.php)
    $token = sgbk_get_graph_token( $opts );
    if ( is_wp_error( $token ) ) {
        return new WP_Error( 'auth_failed', $token->get_error_message(), [ 'status' => 500 ] );
    }

    // Build event times
    try {
        $utc_tz   = new DateTimeZone( 'UTC' );
        $start_dt = new DateTimeImmutable( $slot, $utc_tz );
        $end_dt   = $start_dt->modify( '+30 minutes' );
    } catch ( Exception $e ) {
        return new WP_Error( 'invalid_slot', 'Invalid slot timestamp', [ 'status' => 400 ] );
    }

    $event_body = [
        'subject' => 'Sogolytics Demo — ' . $first_name . ' ' . $last_name,
        'start'   => [ 'dateTime' => $start_dt->format( 'Y-m-d\TH:i:s' ), 'timeZone' => 'UTC' ],
        'end'     => [ 'dateTime' => $end_dt->format( 'Y-m-d\TH:i:s' ),   'timeZone' => 'UTC' ],
        'attendees' => [ [
            'emailAddress' => [ 'address' => $email, 'name' => $first_name . ' ' . $last_name ],
            'type'         => 'required',
        ] ],
        'body' => [
            'contentType' => 'HTML',
            'content'     => implode( '', [
                'Demo booked via sogolytics.com<br><br>',
                '<b>Name:</b> ',        $first_name . ' ' . $last_name, '<br>',
                '<b>Email:</b> ',       $email,       '<br>',
                '<b>Phone:</b> ',       ( $phone ?: 'N/A' ), '<br>',
                '<b>Project type:</b> ',$project,     '<br>',
                '<b>Country:</b> ',     $country,     '<br>',
                '<b>Region bucket:</b> ',$region,
            ] ),
        ],
        'isOnlineMeeting'            => true,
        'onlineMeetingProvider'      => 'teamsForBusiness',
        'reminderMinutesBeforeStart' => 15,
    ];

    $event_url = 'https://graph.microsoft.com/v1.0/users/' . rawurlencode( $cal_email ) . '/events';
    $event_res = wp_remote_post( $event_url, [
        'timeout' => 15,
        'headers' => [
            'Authorization' => 'Bearer ' . $token,
            'Content-Type'  => 'application/json',
        ],
        'body' => wp_json_encode( $event_body ),
    ] );

    if ( is_wp_error( $event_res ) ) {
        error_log( '[sgbk book] event creation wp_error: ' . $event_res->get_error_message() );
        return new WP_Error( 'booking_failed', 'Event creation failed', [ 'status' => 500 ] );
    }

    $event_code = wp_remote_retrieve_response_code( $event_res );
    $event_text = wp_remote_retrieve_body( $event_res );

    if ( $event_code === 409 || ( $event_code >= 400 && stripos( $event_text, 'conflict' ) !== false ) ) {
        return new WP_Error( 'slot_taken', 'This slot was just taken. Please pick another time.', [ 'status' => 409 ] );
    }
    if ( $event_code < 200 || $event_code >= 300 ) {
        error_log( '[sgbk book] event creation HTTP ' . $event_code . ': ' . $event_text );
        return new WP_Error( 'booking_failed', 'Event creation HTTP ' . $event_code, [ 'status' => 500 ] );
    }

    $event_data  = json_decode( $event_text, true );
    $meeting_link = $event_data['onlineMeeting']['joinUrl'] ?? null;

    // Fire-and-forget SF lead (non-blocking)
    if ( ! empty( $opts['sf_client_id'] ) ) {
        sgbk_create_sf_lead( $opts, [
            'firstName'   => $first_name,
            'lastName'    => $last_name,
            'email'       => $email,
            'phone'       => $phone,
            'projectType' => $project,
            'country'     => $country,
        ] );
    }

    return rest_ensure_response( [
        'success'     => true,
        'meetingLink' => $meeting_link,
        'eventId'     => $event_data['id'] ?? null,
        'bookedSlot'  => $slot,
    ] );
}
