<?php
/**
 * REST handler: GET /wp-json/sgbk/v1/availability
 *
 * Pure PHP replacement for api/availability.js — no Vercel needed.
 * Uses wp_remote_post() for Graph API calls and PHP DateTime for
 * timezone conversion (replaces luxon).
 */

if ( ! defined( 'ABSPATH' ) ) exit;

/* ── Demo mode: seeds realistic mock slots when Azure is not configured ── */

function sgbk_mock_slots( $date, $user_tz ) {
    try {
        $cal_tz      = new DateTimeZone( 'America/New_York' );
        $user_tz_obj = new DateTimeZone( $user_tz ?: 'UTC' );
        $utc_tz      = new DateTimeZone( 'UTC' );

        $base = new DateTimeImmutable( $date, $utc_tz );

        // Skip weekends (ISO: 6=Sat, 7=Sun)
        $dow = (int) $base->setTimezone( $cal_tz )->format( 'N' );
        if ( $dow >= 6 ) return [];

        // Vary slots by day so each date looks different
        $seed      = (int) $base->format( 'j' ) + (int) $base->format( 'n' ) * 31;
        $all_hours = [ 9, 9.5, 10, 10.5, 11, 13, 13.5, 14, 14.5, 15, 15.5, 16 ];
        $slots     = [];

        foreach ( $all_hours as $i => $h ) {
            if ( ( $seed + $i ) % 3 === 0 ) continue;

            $hour   = (int) $h;
            $minute = ( $h - $hour > 0 ) ? 30 : 0;

            $slot_et = DateTimeImmutable::createFromFormat(
                'Y-m-d H:i',
                $base->format( 'Y-m-d' ) . ' ' . sprintf( '%02d:%02d', $hour, $minute ),
                $cal_tz
            );
            if ( ! $slot_et ) continue;

            $slot_utc  = $slot_et->setTimezone( $utc_tz );
            $slot_user = $slot_et->setTimezone( $user_tz_obj );

            $slots[] = [
                'iso'     => $slot_utc->format( 'Y-m-d\TH:i:s\Z' ),
                'display' => $slot_user->format( 'l, F j · g:i A' ),
            ];
        }

        return $slots;

    } catch ( Exception $e ) {
        error_log( '[sgbk availability] mock_slots error: ' . $e->getMessage() );
        return [];
    }
}

/* ── Get Microsoft Graph OAuth2 token ── */

function sgbk_get_graph_token( $opts ) {
    $url      = 'https://login.microsoftonline.com/' . $opts['azure_tenant_id'] . '/oauth2/v2.0/token';
    $response = wp_remote_post( $url, [
        'timeout' => 10,
        'body'    => [
            'grant_type'    => 'client_credentials',
            'client_id'     => $opts['azure_client_id'],
            'client_secret' => $opts['azure_client_secret'],
            'scope'         => 'https://graph.microsoft.com/.default',
        ],
    ] );

    if ( is_wp_error( $response ) ) {
        error_log( '[sgbk availability] getGraphToken wp_error: ' . $response->get_error_message() );
        return new WP_Error( 'auth_failed', 'Graph token request failed' );
    }

    $code = wp_remote_retrieve_response_code( $response );
    if ( $code !== 200 ) {
        error_log( '[sgbk availability] getGraphToken HTTP ' . $code . ': ' . wp_remote_retrieve_body( $response ) );
        return new WP_Error( 'auth_failed', 'Graph token HTTP ' . $code );
    }

    $data = json_decode( wp_remote_retrieve_body( $response ), true );
    return $data['access_token'] ?? new WP_Error( 'auth_failed', 'No access_token in response' );
}

/* ── Main REST handler ── */

function sgbk_availability_handler( WP_REST_Request $req ) {
    $region = sanitize_text_field( $req->get_param( 'region' ) ?: 'row' );
    $date   = sanitize_text_field( $req->get_param( 'date' ) );
    $tz     = sanitize_text_field( $req->get_param( 'timezone' ) ?: 'UTC' );

    if ( ! $date || ! preg_match( '/^\d{4}-\d{2}-\d{2}$/', $date ) ) {
        return new WP_Error( 'missing_date', 'date parameter required (YYYY-MM-DD)', [ 'status' => 400 ] );
    }

    // Validate timezone string to prevent errors
    try {
        new DateTimeZone( $tz );
    } catch ( Exception $e ) {
        $tz = 'UTC';
    }

    $opts      = get_option( 'sgbk_settings', [] );
    $tenant_id = $opts['azure_tenant_id'] ?? '';

    /* ── Demo mode ── */
    if ( empty( $tenant_id ) ) {
        error_log( '[sgbk availability] demo mode for ' . $date );
        return rest_ensure_response( [
            'slots'     => sgbk_mock_slots( $date, $tz ),
            'timezone'  => $tz,
            'calRegion' => $region,
            'demo'      => true,
        ] );
    }

    /* ── Live mode ── */
    $cal_tz_map = [
        'us'  => 'America/New_York',
        'row' => 'Asia/Kolkata',
    ];
    $cal_email = ( $region === 'us' )
        ? ( $opts['cal_us']  ?? 'us-demos@sogolytics.com' )
        : ( $opts['cal_row'] ?? 'row-demos@sogolytics.com' );
    $cal_tz    = $cal_tz_map[ $region ] ?? 'Asia/Kolkata';

    $token = sgbk_get_graph_token( $opts );
    if ( is_wp_error( $token ) ) {
        return new WP_Error( 'auth_failed', 'Calendar authentication failed', [ 'status' => 500 ] );
    }

    // Call Graph getSchedule
    $schedule_url  = 'https://graph.microsoft.com/v1.0/users/' . rawurlencode( $cal_email ) . '/calendar/getSchedule';
    $schedule_body = wp_json_encode( [
        'schedules'                => [ $cal_email ],
        'startTime'                => [ 'dateTime' => $date . 'T00:00:00', 'timeZone' => 'UTC' ],
        'endTime'                  => [ 'dateTime' => $date . 'T23:59:59', 'timeZone' => 'UTC' ],
        'availabilityViewInterval' => 30,
    ] );

    $graph_res = wp_remote_post( $schedule_url, [
        'timeout' => 10,
        'headers' => [
            'Authorization' => 'Bearer ' . $token,
            'Content-Type'  => 'application/json',
        ],
        'body' => $schedule_body,
    ] );

    if ( is_wp_error( $graph_res ) ) {
        error_log( '[sgbk availability] getSchedule wp_error: ' . $graph_res->get_error_message() );
        return new WP_Error( 'calendar_unavailable', 'Calendar request failed', [ 'status' => 500 ] );
    }

    $graph_code = wp_remote_retrieve_response_code( $graph_res );
    if ( $graph_code !== 200 ) {
        error_log( '[sgbk availability] getSchedule HTTP ' . $graph_code . ': ' . wp_remote_retrieve_body( $graph_res ) );
        return new WP_Error( 'calendar_unavailable', 'Calendar HTTP ' . $graph_code, [ 'status' => 500 ] );
    }

    $schedule_data = json_decode( wp_remote_retrieve_body( $graph_res ), true );
    $avail_view    = $schedule_data['value'][0]['availabilityView'] ?? '';

    // Parse availabilityView — each char = 30-min slot from midnight UTC
    $slots   = [];
    $utc_tz  = new DateTimeZone( 'UTC' );
    $cal_tz_obj  = new DateTimeZone( $cal_tz );
    $user_tz_obj = new DateTimeZone( $tz );
    $base    = new DateTimeImmutable( $date . 'T00:00:00', $utc_tz );

    for ( $i = 0, $len = strlen( $avail_view ); $i < $len; $i++ ) {
        if ( $avail_view[ $i ] !== '0' ) continue;

        $slot_utc  = $base->modify( '+' . ( $i * 30 ) . ' minutes' );
        $slot_cal  = $slot_utc->setTimezone( $cal_tz_obj );

        // Skip weekends
        if ( (int) $slot_cal->format( 'N' ) >= 6 ) continue;

        // Working hours 09:00–17:00 in calendar owner's timezone
        $total_min = (int) $slot_cal->format( 'H' ) * 60 + (int) $slot_cal->format( 'i' );
        if ( $total_min < 540 || $total_min >= 1020 ) continue;

        $slot_user = $slot_utc->setTimezone( $user_tz_obj );
        $slots[]   = [
            'iso'     => $slot_utc->format( 'Y-m-d\TH:i:s\Z' ),
            'display' => $slot_user->format( 'l, F j · g:i A' ),
        ];
    }

    return rest_ensure_response( [
        'slots'     => $slots,
        'timezone'  => $tz,
        'calRegion' => $region,
    ] );
}
