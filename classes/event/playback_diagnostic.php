<?php
// Copyright (C) 2026 DaniMarqz. GPL-3.0-or-later; see LICENSE.
namespace filter_impronta\event;
defined('MOODLE_INTERNAL') || die();

/** Playback evidence declared by a selected learner's browser. Not a billing event. */
class playback_diagnostic extends \core\event\base {
    protected function init() {
        $this->data['crud'] = 'r';
        $this->data['edulevel'] = self::LEVEL_OTHER;
    }

    public static function get_name() {
        return get_string('playbackdiagnostic', 'filter_impronta');
    }

    public function get_description() {
        return "Playback diagnostic for user '{$this->relateduserid}' (" . $this->other['report']['reason'] . ').';
    }
}
