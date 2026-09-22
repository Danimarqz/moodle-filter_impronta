<?php
// This file is part of Moodle - https://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <https://www.gnu.org/licenses/>.

/**
 * Privacy metadata for data sent from Moodle to Impronta.
 *
 * @package   filter_impronta
 * @copyright 2026 DaniMarqz
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace filter_impronta\privacy;


use core_privacy\local\metadata\collection;
use core_privacy\local\metadata\provider as metadata_provider;
use core_privacy\local\request\approved_contextlist;
use core_privacy\local\request\approved_userlist;
use core_privacy\local\request\contextlist;
use core_privacy\local\request\userlist;

/**
 * Describes the personal data exported to the Impronta service.
 */
class provider implements
    \core_privacy\local\request\core_userlist_provider,
    \core_privacy\local\request\plugin\provider,
    metadata_provider {
    /**
     * Describes the data sent to Impronta.
     * @param collection $collection Collection to extend.
     * @return collection
     */
    public static function get_metadata(collection $collection): collection {
        $collection->add_external_location_link('impronta', [
            'subject' => 'privacy:metadata:impronta:subject',
            'watermarklabel' => 'privacy:metadata:impronta:watermarklabel',
            'ip' => 'privacy:metadata:impronta:ip',
            'videopath' => 'privacy:metadata:impronta:videopath',
            'authorizationgroupid' => 'privacy:metadata:impronta:authorizationgroupid',
            'sessionid' => 'privacy:metadata:impronta:sessionid',
            'playbackid' => 'privacy:metadata:impronta:playbackid',
            'eventtype' => 'privacy:metadata:impronta:eventtype',
            'eventpositionseconds' => 'privacy:metadata:impronta:eventpositionseconds',
            'eventtimestamp' => 'privacy:metadata:impronta:eventtimestamp',
            'eventmode' => 'privacy:metadata:impronta:eventmode',
            'eventclient' => 'privacy:metadata:impronta:eventclient',
            'eventflushreason' => 'privacy:metadata:impronta:eventflushreason',
            'watchedseconds' => 'privacy:metadata:impronta:watchedseconds',
            'batchid' => 'privacy:metadata:impronta:batchid',
        ], 'privacy:metadata:impronta');

        return $collection;
    }

    /**
     * Finds contexts containing user data.
     * @param int $userid User ID.
     * @return contextlist Matching contexts.
     */
    public static function get_contexts_for_userid(int $userid): contextlist {
        return new contextlist();
    }

    /**
     * Exports user data; this plugin stores no Moodle-side personal data.
     * @param approved_contextlist $contextlist Approved contexts.
     */
    public static function export_user_data(approved_contextlist $contextlist): void {
    }

    /**
     * Deletes all user data in a context.
     * @param \context $context Context to clean.
     */
    public static function delete_data_for_all_users_in_context(\context $context): void {
    }

    /**
     * Deletes one user's data in approved contexts.
     * @param approved_contextlist $contextlist Approved contexts.
     */
    public static function delete_data_for_user(approved_contextlist $contextlist): void {
    }

    /**
     * Adds users with plugin data to a user list.
     * @param userlist $userlist User list to update.
     */
    public static function get_users_in_context(userlist $userlist): void {
    }

    /**
     * Deletes data for users in an approved list.
     * @param approved_userlist $userlist Approved user list.
     */
    public static function delete_data_for_users(approved_userlist $userlist): void {
    }
}
